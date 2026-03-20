import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { mockClient } from './brain-test-helpers.js';

describe('step creation', () => {
  it('should create a step that updates state', async () => {
    const testBrain = brain('Simple Brain').step(
      'Simple step',
      ({ state }) => ({
        ...state,
        count: 1,
        message: 'Count is now 1',
      })
    );

    const events = [];
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, event.patch);
      }
    }

    // Skip checking events[0] (brain:start)
    // Skip checking events[1] (step:status)

    // Verify the step start event
    expect(events[2]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Simple step',
        stepId: expect.any(String),
        options: {},
      })
    );

    // Verify the step status event (running)
    expect(events[3]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
        options: {},
      })
    );
    if (events[3].type === BRAIN_EVENTS.STEP_STATUS) {
      expect(events[3].steps[0].status).toBe(STATUS.RUNNING);
    }

    // Verify the step complete event
    expect(events[4]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: 'Simple step',
        stepId: expect.any(String),
        patch: [
          {
            op: 'add',
            path: '/count',
            value: 1,
          },
          {
            op: 'add',
            path: '/message',
            value: 'Count is now 1',
          },
        ],
        options: {},
      })
    );

    expect(events[5]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: [
          expect.objectContaining({
            title: 'Simple step',
            status: STATUS.COMPLETE,
            id: expect.any(String),
          }),
        ],
        options: {},
      })
    );

    // Verify the brain complete event
    expect(events[6]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        brainTitle: 'Simple Brain',
        options: {},
      })
    );
    // Verify the final state
    expect(finalState).toEqual({
      count: 1,
      message: 'Count is now 1',
    });
  });

  it('should maintain immutable results between steps', async () => {
    const testBrain = brain('Immutable Steps Brain')
      .step('First step', () => ({
        value: 1,
      }))
      .step('Second step', ({ state }) => {
        // Attempt to modify previous step's state
        state.value = 99;
        return {
          value: 2,
        };
      });

    let finalState = {};
    const patches = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        patches.push(...event.patch);
      }
    }

    // Apply all patches to the initial state
    finalState = applyPatches(finalState, patches);

    // Verify the final state
    expect(finalState).toEqual({ value: 2 });
  });
});

describe('brain structure', () => {
  it('should expose brain structure with steps', () => {
    const testBrain = brain({
      title: 'Test Brain',
      description: 'A test brain description',
    })
      .step('First step', ({ state }) => ({ ...state, step1: true }))
      .step('Second step', ({ state }) => ({ ...state, step2: true }))
      .step('Third step', ({ state }) => ({ ...state, step3: true }));

    const structure = testBrain.structure;

    expect(structure).toEqual({
      title: 'Test Brain',
      description: 'A test brain description',
      steps: [
        { type: 'step', title: 'First step' },
        { type: 'step', title: 'Second step' },
        { type: 'step', title: 'Third step' },
      ],
    });
  });

  it('should expose nested brain structure recursively', () => {
    const innerBrain = brain({
      title: 'Inner Brain',
      description: 'An inner brain',
    })
      .step('Inner step 1', ({ state }) => ({ ...state, inner1: true }))
      .step('Inner step 2', ({ state }) => ({ ...state, inner2: true }));

    const outerBrain = brain({
      title: 'Outer Brain',
      description: 'An outer brain',
    })
      .step('Outer step 1', ({ state }) => ({ ...state, outer1: true }))
      .brain('Run inner brain', innerBrain)
      .step('Outer step 2', ({ state }) => ({ ...state, outer2: true }));

    const structure = outerBrain.structure;

    expect(structure).toEqual({
      title: 'Outer Brain',
      description: 'An outer brain',
      steps: [
        { type: 'step', title: 'Outer step 1' },
        {
          type: 'brain',
          title: 'Run inner brain',
          innerBrain: {
            title: 'Inner Brain',
            description: 'An inner brain',
            steps: [
              { type: 'step', title: 'Inner step 1' },
              { type: 'step', title: 'Inner step 2' },
            ],
          },
        },
        { type: 'step', title: 'Outer step 2' },
      ],
    });
  });

  it('should handle brain without description', () => {
    const testBrain = brain('No Description Brain').step(
      'Only step',
      ({ state }) => state
    );

    const structure = testBrain.structure;

    expect(structure).toEqual({
      title: 'No Description Brain',
      description: undefined,
      steps: [{ type: 'step', title: 'Only step' }],
    });
  });

  describe('step error propagation', () => {
    it('should propagate step errors immediately without retry', async () => {
      let callCount = 0;
      const testBrain = brain('Error Propagation Brain').step(
        'Failing step',
        () => {
          callCount++;
          throw new Error('Step failed');
        }
      );

      const events: BrainEvent<any>[] = [];
      let error: Error | undefined;

      try {
        for await (const event of testBrain.run({
          client: mockClient,
          currentUser: { name: 'test-user' },
        })) {
          events.push(event);
        }
      } catch (e) {
        error = e as Error;
      }

      // Verify step was called only once (no retry)
      expect(callCount).toBe(1);

      // Verify error was thrown
      expect(error?.message).toBe('Step failed');

      // Verify ERROR event was emitted
      const errorEvent = events.find((e) => e.type === BRAIN_EVENTS.ERROR);
      expect(errorEvent).toBeDefined();
      expect(errorEvent).toEqual(
        expect.objectContaining({
          type: BRAIN_EVENTS.ERROR,
          status: STATUS.ERROR,
          error: expect.objectContaining({
            message: 'Step failed',
          }),
        })
      );
    });
  });
});
