import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import {
  brain,
  type BrainEvent,
  type ResumeContext,
} from '../src/dsl/brain.js';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';

const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
};

function collectEvents(events: BrainEvent[]): {
  stepCompletes: BrainEvent[];
  stepStatuses: BrainEvent[];
  finalState: object;
} {
  const stepCompletes = events.filter((e) => e.type === BRAIN_EVENTS.STEP_COMPLETE);
  const stepStatuses = events.filter((e) => e.type === BRAIN_EVENTS.STEP_STATUS);
  let state = {};
  for (const event of stepCompletes) {
    if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
      state = applyPatches(state, [event.patch]);
    }
  }
  return { stepCompletes, stepStatuses, finalState: state };
}

describe('guard', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
  });

  it('should continue execution when guard passes (predicate true)', async () => {
    const testBrain = brain('guard-pass')
      .step('Init', () => ({ important: true }))
      .guard(({ state }) => state.important)
      .step('Process', ({ state }) => ({ ...state, processed: true }))
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ important: true, processed: true, done: true });
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should skip remaining steps when guard fails (predicate false)', async () => {
    const testBrain = brain('guard-fail')
      .step('Init', () => ({ important: false }))
      .guard(({ state }) => state.important)
      .step('Process', ({ state }) => ({ ...state, processed: true }))
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { stepCompletes, finalState } = collectEvents(events);

    // Should have: Init complete, Guard complete, Process halted, Done halted
    expect(stepCompletes).toHaveLength(4);
    expect(stepCompletes[0]).toEqual(expect.objectContaining({ stepTitle: 'Init' }));
    expect(stepCompletes[1]).toEqual(expect.objectContaining({ stepTitle: 'Guard' }));
    expect(stepCompletes[2]).toEqual(expect.objectContaining({ stepTitle: 'Process', halted: true, patch: [] }));
    expect(stepCompletes[3]).toEqual(expect.objectContaining({ stepTitle: 'Done', halted: true, patch: [] }));

    // State should only have what Init produced (guard doesn't modify, remaining halted)
    expect(finalState).toEqual({ important: false });
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should complete immediately when guard fails with no steps after it', async () => {
    const testBrain = brain('guard-fail-end')
      .step('Init', () => ({ value: 0 }))
      .guard(({ state }) => state.value > 0);

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ value: 0 });
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should handle multiple guards — first passes, second fails', async () => {
    const testBrain = brain('guard-multi-1')
      .step('Init', () => ({ a: true, b: false }))
      .guard(({ state }) => state.a, 'Check A')
      .step('After A', ({ state }) => ({ ...state, passedA: true }))
      .guard(({ state }) => state.b, 'Check B')
      .step('After B', ({ state }) => ({ ...state, passedB: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ a: true, b: false, passedA: true });
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should handle multiple guards — first fails, all remaining skipped', async () => {
    const testBrain = brain('guard-multi-2')
      .step('Init', () => ({ a: false, b: true }))
      .guard(({ state }) => state.a, 'Check A')
      .step('After A', ({ state }) => ({ ...state, passedA: true }))
      .guard(({ state }) => state.b, 'Check B')
      .step('After B', ({ state }) => ({ ...state, passedB: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { stepCompletes, finalState } = collectEvents(events);

    // Init complete, Check A complete, After A halted, Check B halted, After B halted
    expect(stepCompletes).toHaveLength(5);
    expect(stepCompletes[2]).toEqual(expect.objectContaining({ stepTitle: 'After A', halted: true }));
    expect(stepCompletes[3]).toEqual(expect.objectContaining({ stepTitle: 'Check B', halted: true }));
    expect(stepCompletes[4]).toEqual(expect.objectContaining({ stepTitle: 'After B', halted: true }));

    expect(finalState).toEqual({ a: false, b: true });
  });

  it('should flow state correctly to steps after a passing guard', async () => {
    const testBrain = brain('guard-state-flow')
      .step('Init', () => ({ value: 10 }))
      .guard(({ state }) => state.value > 5)
      .step('Process', ({ state }) => ({ ...state, doubled: state.value * 2 }))
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ value: 10, doubled: 20, done: true });
  });

  it('should preserve current state when guard fails', async () => {
    const testBrain = brain('guard-preserve')
      .step('Init', () => ({ count: 5, label: 'test' }))
      .guard(({ state }) => state.count > 10)
      .step('Never runs', ({ state }) => ({ ...state, modified: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ count: 5, label: 'test' });
  });

  it('should emit correct event sequence for guard pass', async () => {
    const testBrain = brain('guard-events-pass')
      .step('Init', () => ({ flag: true }))
      .guard(({ state }) => state.flag, 'Check flag')
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    expect(types).toEqual([
      BRAIN_EVENTS.START,
      BRAIN_EVENTS.STEP_STATUS,      // initial
      BRAIN_EVENTS.STEP_START,        // Init
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE,     // Init
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_START,        // Check flag (guard)
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE,     // Check flag (guard pass — empty patch)
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_START,        // Done
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE,     // Done
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.COMPLETE,
    ]);
  });

  it('should emit correct event sequence for guard fail', async () => {
    const testBrain = brain('guard-events-fail')
      .step('Init', () => ({ flag: false }))
      .guard(({ state }) => state.flag, 'Check flag')
      .step('A', ({ state }) => ({ ...state, a: true }))
      .step('B', ({ state }) => ({ ...state, b: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    expect(types).toEqual([
      BRAIN_EVENTS.START,
      BRAIN_EVENTS.STEP_STATUS,      // initial
      BRAIN_EVENTS.STEP_START,        // Init
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE,     // Init
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_START,        // Check flag (guard)
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE,     // Check flag (guard)
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE,     // A (skipped)
      BRAIN_EVENTS.STEP_COMPLETE,     // B (skipped)
      BRAIN_EVENTS.STEP_STATUS,       // final status showing all skipped
      BRAIN_EVENTS.COMPLETE,
    ]);
  });

  it('should show HALTED status for remaining steps when guard fails', async () => {
    const testBrain = brain('guard-status')
      .step('Init', () => ({ flag: false }))
      .guard(({ state }) => state.flag, 'Check')
      .step('A', ({ state }) => ({ ...state, a: true }))
      .step('B', ({ state }) => ({ ...state, b: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    // Find the last STEP_STATUS event
    const stepStatusEvents = events.filter((e) => e.type === BRAIN_EVENTS.STEP_STATUS);
    const lastStatus = stepStatusEvents[stepStatusEvents.length - 1];

    expect(lastStatus.type).toBe(BRAIN_EVENTS.STEP_STATUS);
    if (lastStatus.type === BRAIN_EVENTS.STEP_STATUS) {
      // Init = complete, Check = complete, A = skipped, B = skipped
      expect(lastStatus.steps[0].status).toBe(STATUS.COMPLETE);
      expect(lastStatus.steps[1].status).toBe(STATUS.COMPLETE);
      expect(lastStatus.steps[2].status).toBe(STATUS.HALTED);
      expect(lastStatus.steps[3].status).toBe(STATUS.HALTED);
    }
  });

  it('should resume after guard has already passed', async () => {
    const testBrain = brain('guard-resume-pass')
      .step('Init', () => ({ value: 10 }))
      .guard(({ state }) => state.value > 5)
      .step('After', ({ state }) => ({ ...state, done: true }));

    // Simulate resuming after guard already passed (stepIndex = 2: Init + Guard done)
    const resumeState = { value: 10 };

    const resumeContext: ResumeContext = {
      state: resumeState,
      stepIndex: 2, // Past Init(0) and Guard(1)
    };

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      resumeContext,
      brainRunId: 'test-run-id',
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

    let finalState: object = resumeState;
    for (const event of events) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(finalState).toEqual({ value: 10, done: true });
  });

  it('should resume after guard has already failed (all remaining skipped)', async () => {
    const testBrain = brain('guard-resume-fail')
      .step('Init', () => ({ value: 0 }))
      .guard(({ state }) => state.value > 5)
      .step('After', ({ state }) => ({ ...state, done: true }));

    // Simulate resuming after everything completed (guard failed, all skipped)
    // stepIndex = 3 means all steps are past
    const resumeState = { value: 0 };

    const resumeContext: ResumeContext = {
      state: resumeState,
      stepIndex: 3, // Past Init(0), Guard(1), After(2) — all done
    };

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      resumeContext,
      brainRunId: 'test-run-id',
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

    // No new step completions, brain just completes
    const stepCompletes = events.filter((e) => e.type === BRAIN_EVENTS.STEP_COMPLETE);
    expect(stepCompletes).toHaveLength(0);
  });

  it('should show guard with type guard in structure getter', () => {
    const testBrain = brain('guard-structure')
      .step('Init', () => ({ flag: true }))
      .guard(({ state }) => state.flag, 'My Guard');

    const structure = testBrain.structure;
    expect(structure.steps).toHaveLength(2);
    expect(structure.steps[0]).toEqual({ type: 'step', title: 'Init' });
    expect(structure.steps[1]).toEqual({ type: 'guard', title: 'My Guard' });
  });

  it('should default guard title to Guard', () => {
    const testBrain = brain('guard-default-title')
      .step('Init', () => ({ flag: true }))
      .guard(({ state }) => state.flag);

    const structure = testBrain.structure;
    expect(structure.steps[1]).toEqual({ type: 'guard', title: 'Guard' });
  });

  it('should preserve state type after guard (type inference)', () => {
    const testBrain = brain('guard-types')
      .step('Init', () => ({ count: 0, name: 'test' }))
      .guard(({ state }) => state.count > 0)
      .step('After', ({ state }) => {
        // If type inference works, state has count: number and name: string
        const _count: number = state.count;
        const _name: string = state.name;
        return { ...state, processed: true };
      });

    expect(testBrain).toBeDefined();
  });

  it('should work with options in guard predicate', async () => {
    const { z } = await import('zod');

    const testBrain = brain('guard-options')
      .withOptionsSchema(z.object({ threshold: z.number() }))
      .step('Init', () => ({ value: 5 }))
      .guard(({ state, options }) => state.value > options.threshold, 'Threshold check')
      .step('Process', ({ state }) => ({ ...state, processed: true }));

    // Guard should fail (5 is not > 10)
    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient, options: { threshold: 10 } })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ value: 5 });

    // Guard should pass (5 > 3)
    const events2: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient, options: { threshold: 3 } })) {
      events2.push(event);
    }

    const { finalState: finalState2 } = collectEvents(events2);
    expect(finalState2).toEqual({ value: 5, processed: true });
  });
});
