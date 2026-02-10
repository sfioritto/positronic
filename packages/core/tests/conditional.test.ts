import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import {
  brain,
  type BrainEvent,
  type ResumeContext,
} from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import { createWebhook } from '../src/index.js';

type AssertEquals<T, U> = 0 extends 1 & T
  ? false
  : 0 extends 1 & U
  ? false
  : [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;

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

describe('conditional branching', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
  });

  it('should execute then-branch when predicate is true', async () => {
    const testBrain = brain('cond-true')
      .step('Init', () => ({ important: true }))
      .if(({ state }) => state.important)
        .then('Notify', ({ state }) => ({ ...state, notified: true }))
        .else('Skip', ({ state }) => ({ ...state, notified: false }))
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { stepCompletes, finalState } = collectEvents(events);

    // Should have 4 STEP_COMPLETE events: Init, Notify, Skip (skipped, empty patch), Done
    expect(stepCompletes).toHaveLength(4);
    expect(stepCompletes[0]).toEqual(expect.objectContaining({ stepTitle: 'Init' }));
    expect(stepCompletes[1]).toEqual(expect.objectContaining({ stepTitle: 'Notify' }));
    expect(stepCompletes[2]).toEqual(expect.objectContaining({ stepTitle: 'Skip', patch: [] }));
    expect(stepCompletes[3]).toEqual(expect.objectContaining({ stepTitle: 'Done' }));

    expect(finalState).toEqual({ important: true, notified: true, done: true });

    // Verify COMPLETE event
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should execute else-branch when predicate is false', async () => {
    const testBrain = brain('cond-false')
      .step('Init', () => ({ important: false }))
      .if(({ state }) => state.important)
        .then('Notify', ({ state }) => ({ ...state, notified: true }))
        .else('Skip', ({ state }) => ({ ...state, notified: false }))
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { stepCompletes, finalState } = collectEvents(events);

    expect(stepCompletes).toHaveLength(4);
    expect(stepCompletes[0]).toEqual(expect.objectContaining({ stepTitle: 'Init' }));
    // When predicate is false: else-branch executes first, then then-branch gets skipped
    expect(stepCompletes[1]).toEqual(expect.objectContaining({ stepTitle: 'Skip' }));
    expect(stepCompletes[2]).toEqual(expect.objectContaining({ stepTitle: 'Notify', patch: [] }));
    expect(stepCompletes[3]).toEqual(expect.objectContaining({ stepTitle: 'Done' }));

    expect(finalState).toEqual({ important: false, notified: false, done: true });
  });

  it('should show SKIPPED status for the unchosen branch', async () => {
    const testBrain = brain('cond-status')
      .step('Init', () => ({ flag: true }))
      .if(({ state }) => state.flag)
        .then('Then', ({ state }) => ({ ...state, path: 'then' }))
        .else('Else', ({ state }) => ({ ...state, path: 'else' }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    // Find the last STEP_STATUS event
    const stepStatusEvents = events.filter((e) => e.type === BRAIN_EVENTS.STEP_STATUS);
    const lastStatus = stepStatusEvents[stepStatusEvents.length - 1];

    expect(lastStatus.type).toBe(BRAIN_EVENTS.STEP_STATUS);
    if (lastStatus.type === BRAIN_EVENTS.STEP_STATUS) {
      // Init = complete, Then = complete, Else = skipped
      expect(lastStatus.steps[0].status).toBe(STATUS.COMPLETE);
      expect(lastStatus.steps[1].status).toBe(STATUS.COMPLETE);
      expect(lastStatus.steps[2].status).toBe(STATUS.SKIPPED);
    }
  });

  it('should flow state correctly to next step from the chosen branch', async () => {
    const testBrain = brain('cond-state-flow')
      .step('Init', () => ({ value: 10 }))
      .if(({ state }) => state.value > 5)
        .then('High', ({ state }) => ({ ...state, category: 'high' }))
        .else('Low', ({ state }) => ({ ...state, category: 'low' }))
      .step('Process', ({ state }) => ({ ...state, processed: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ value: 10, category: 'high', processed: true });
  });

  it('should handle waitFor in then-branch', async () => {
    const testWebhook = createWebhook(
      'test-webhook',
      z.object({ response: z.string() }),
      async () => ({
        type: 'webhook' as const,
        identifier: 'test-id',
        response: { response: 'ok' },
      })
    );

    const testBrain = brain('cond-waitfor-then')
      .step('Init', () => ({ needsInput: true }))
      .if(({ state }) => state.needsInput)
        .then('Ask', ({ state }) => ({
          state: { ...state, asked: true },
          waitFor: [testWebhook('user-1')],
        }))
        .else('Skip', ({ state }) => ({ ...state, asked: false }))
      .step('After', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    // Should emit a WEBHOOK event (brain continues to completion when run directly)
    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.WEBHOOK,
        waitFor: [{ slug: 'test-webhook', identifier: 'user-1' }],
      })
    );

    // Brain completes when run directly (pausing is managed by BrainRunner)
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ needsInput: true, asked: true, done: true });
  });

  it('should not pause when the non-waitFor branch runs', async () => {
    const testWebhook = createWebhook(
      'test-webhook2',
      z.object({ response: z.string() }),
      async () => ({
        type: 'webhook' as const,
        identifier: 'test-id',
        response: { response: 'ok' },
      })
    );

    const testBrain = brain('cond-no-waitfor')
      .step('Init', () => ({ needsInput: false }))
      .if(({ state }) => state.needsInput)
        .then('Ask', ({ state }) => ({
          state: { ...state, asked: true },
          waitFor: [testWebhook('user-1')],
        }))
        .else('Skip', ({ state }) => ({ ...state, asked: false }))
      .step('After', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    // Should complete successfully without pausing
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

    // No WEBHOOK event
    expect(events.some((e) => e.type === BRAIN_EVENTS.WEBHOOK)).toBe(false);

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ needsInput: false, asked: false, done: true });
  });

  it('should handle response as undefined when the non-waitFor branch runs', async () => {
    const testWebhook = createWebhook(
      'test-webhook3',
      z.object({ answer: z.string() }),
      async () => ({
        type: 'webhook' as const,
        identifier: 'test-id',
        response: { answer: 'yes' },
      })
    );

    const testBrain = brain('cond-response-undef')
      .step('Init', () => ({ skip: true }))
      .if(({ state }) => !state.skip)
        .then('Ask', ({ state }) => ({
          state: { ...state, asked: true },
          waitFor: [testWebhook('user-1')],
        }))
        .else('Skip', ({ state }) => ({ ...state, asked: false }))
      .step('After', ({ state, response }) => {
        // response should be undefined since the else-branch (no waitFor) ran
        return { ...state, hasResponse: response !== undefined };
      });

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ skip: true, asked: false, hasResponse: false });
  });

  it('should handle multiple conditionals in sequence', async () => {
    const testBrain = brain('cond-multi')
      .step('Init', () => ({ a: true, b: false }))
      .if(({ state }) => state.a)
        .then('A-Yes', ({ state }) => ({ ...state, resultA: 'yes' }))
        .else('A-No', ({ state }) => ({ ...state, resultA: 'no' }))
      .if(({ state }) => state.b)
        .then('B-Yes', ({ state }) => ({ ...state, resultB: 'yes' }))
        .else('B-No', ({ state }) => ({ ...state, resultB: 'no' }))
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({
      a: true,
      b: false,
      resultA: 'yes',
      resultB: 'no',
      done: true,
    });

    // Verify completion
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should produce correct event sequence', async () => {
    const testBrain = brain('cond-events')
      .step('Init', () => ({ flag: true }))
      .if(({ state }) => state.flag)
        .then('Then', ({ state }) => ({ ...state, result: 'then' }))
        .else('Else', ({ state }) => ({ ...state, result: 'else' }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    // Expected sequence:
    // START, STEP_STATUS (initial),
    // STEP_START (Init), STEP_STATUS, STEP_COMPLETE (Init), STEP_STATUS,
    // STEP_START (Then), STEP_STATUS, STEP_COMPLETE (Then), STEP_STATUS,
    // STEP_COMPLETE (Else - skipped, empty patch), STEP_STATUS,
    // COMPLETE
    expect(types).toEqual([
      BRAIN_EVENTS.START,
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_START,    // Init
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE, // Init
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_START,    // Then (chosen branch)
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE, // Then
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.STEP_COMPLETE, // Else (skipped)
      BRAIN_EVENTS.STEP_STATUS,
      BRAIN_EVENTS.COMPLETE,
    ]);
  });

  it('should infer union state type from both branches', () => {
    const testBrain = brain('cond-types')
      .step('Init', () => ({ value: 1 }))
      .if(({ state }) => state.value > 0)
        .then('Positive', ({ state }) => ({ ...state, sign: 'positive' as const }))
        .else('Non-positive', ({ state }) => ({ ...state, sign: 'non-positive' as const }))
      .step('Check', ({ state }) => {
        // State should be the union: both branches add 'sign'
        const _sign: 'positive' | 'non-positive' = state.sign;
        return { ...state, checked: true };
      });

    expect(testBrain).toBeDefined();
  });

  it('should infer response as including undefined for conditionals', () => {
    const testWebhook = createWebhook(
      'test-webhook4',
      z.object({ data: z.string() }),
      async () => ({
        type: 'webhook' as const,
        identifier: 'test-id',
        response: { data: 'hello' },
      })
    );

    const testBrain = brain('cond-response-types')
      .step('Init', () => ({ flag: true }))
      .if(({ state }) => state.flag)
        .then('Wait', ({ state }) => ({
          state: { ...state, waited: true },
          waitFor: [testWebhook('id')],
        }))
        .else('Skip', ({ state }) => ({ ...state, waited: false }))
      .step('After', ({ state, response }) => {
        // response should include undefined
        type ResponseType = typeof response;
        type _Check = AssertEquals<ResponseType, { data: string } | undefined>;
        const _: _Check = true;
        return state;
      });

    expect(testBrain).toBeDefined();
  });

  it('should resume correctly after conditional', async () => {
    const testBrain = brain('cond-resume')
      .step('Init', () => ({ value: 10 }))
      .if(({ state }) => state.value > 5)
        .then('High', ({ state }) => ({ ...state, category: 'high' }))
        .else('Low', ({ state }) => ({ ...state, category: 'low' }))
      .step('After', ({ state }) => ({
        ...state,
        done: true,
      }));

    // Simulate resuming after the conditional has completed (stepIndex = 3: Init + Then + Else)
    // State reflects Init + High branch
    const resumeState = { value: 10, category: 'high' };

    const resumeContext: ResumeContext = {
      state: resumeState,
      stepIndex: 3, // Past Init(0), Then(1), Else(2) - all conditional steps done
    };

    const resumeEvents: BrainEvent[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      resumeContext,
      brainRunId: 'test-run-id',
    })) {
      resumeEvents.push(event);
    }

    // Should complete on resume
    expect(resumeEvents.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

    // Reconstruct final state from resume
    let finalState: object = resumeState;
    for (const event of resumeEvents) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(finalState).toEqual({
      value: 10,
      category: 'high',
      done: true,
    });
  });

  it('should handle async step actions in conditional branches', async () => {
    const testBrain = brain('cond-async')
      .step('Init', () => ({ value: 42 }))
      .if(({ state }) => state.value > 0)
        .then('Async Then', async ({ state }) => {
          return { ...state, doubled: state.value * 2 };
        })
        .else('Async Else', async ({ state }) => {
          return { ...state, doubled: 0 };
        })
      .step('Done', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent[] = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    const { finalState } = collectEvents(events);
    expect(finalState).toEqual({ value: 42, doubled: 84, done: true });
  });

  it('should provide the brain structure with conditional info', () => {
    const testBrain = brain('cond-structure')
      .step('Init', () => ({ flag: true }))
      .if(({ state }) => state.flag)
        .then('Then Branch', ({ state }) => state)
        .else('Else Branch', ({ state }) => state);

    const structure = testBrain.structure;
    expect(structure.steps).toHaveLength(2); // Init + 1 conditional block
    expect(structure.steps[0]).toEqual({ type: 'step', title: 'Init' });
    expect(structure.steps[1]).toEqual({
      type: 'conditional',
      title: 'Then Branch / Else Branch',
      thenStep: { title: 'Then Branch' },
      elseStep: { title: 'Else Branch' },
    });
  });
});
