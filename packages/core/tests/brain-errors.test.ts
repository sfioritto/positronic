import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import {
  brain,
  type BrainEvent,
  type BrainErrorEvent,
} from '../src/dsl/brain.js';
import { mockClient } from './brain-test-helpers.js';

describe('error handling', () => {
  it('should handle errors in actions and maintain correct status', async () => {
    const errorBrain = brain('Error Brain')
      // Step 1: Normal step
      .step('First step', () => ({
        value: 1,
      }))
      // Step 2: Error step
      .step('Error step', () => {
        if (true) {
          throw new Error('Test error');
        }
        return {
          value: 1,
        };
      })
      // Step 3: Should never execute
      .step('Never reached', ({ state }) => ({
        value: state.value + 1,
      }));

    let errorEvent, finalStepStatusEvent;
    try {
      for await (const event of errorBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
      })) {
        if (event.type === BRAIN_EVENTS.ERROR) {
          errorEvent = event;
        }
        if (event.type === BRAIN_EVENTS.STEP_STATUS) {
          finalStepStatusEvent = event;
        }
      }
    } catch (error) {
      // Error is expected to be thrown
    }

    // Verify final state
    expect(errorEvent?.status).toBe(STATUS.ERROR);
    expect(errorEvent?.error?.message).toBe('Test error');

    // Verify steps status
    if (!finalStepStatusEvent?.steps) {
      throw new Error('Steps not found');
    }
    expect(finalStepStatusEvent.steps[0].status).toBe(STATUS.COMPLETE);
    expect(finalStepStatusEvent.steps[1].status).toBe(STATUS.ERROR);
    expect(finalStepStatusEvent.steps[2].status).toBe(STATUS.PENDING);

    // Verify error event structure
    expect(errorEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.ERROR,
        status: STATUS.ERROR,
        brainTitle: 'Error Brain',
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String),
        }),
      })
    );
  });

  it('should handle errors in nested brains and propagate them up', async () => {
    // Create an inner brain that will throw an error
    const innerBrain = brain<{}, { inner?: boolean; value?: number }>(
      'Failing Inner Brain'
    ).step('Throw error', (): { value: number } => {
      throw new Error('Inner brain error');
    });

    // Create outer brain that uses the failing inner brain
    const outerBrain = brain('Outer Brain')
      .step('First step', () => ({ step: 'first' }))
      .brain('Run inner brain', innerBrain, {
        initialState: { value: 5 },
      });

    const events: BrainEvent<any>[] = [];
    let error: Error | undefined;
    let mainBrainId: string | undefined;

    try {
      for await (const event of outerBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
      })) {
        events.push(event);
        if (event.type === BRAIN_EVENTS.START && !mainBrainId) {
          mainBrainId = event.brainRunId;
        }
      }
    } catch (e) {
      error = e as Error;
    }

    // Verify error was thrown
    expect(error?.message).toBe('Inner brain error');

    // Verify event sequence including error
    expect(events).toEqual([
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Outer Brain',
        status: STATUS.RUNNING,
        brainRunId: mainBrainId,
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'First step',
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: 'First step',
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner brain',
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Failing Inner Brain',
        status: STATUS.RUNNING,
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Throw error',
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.ERROR,
        brainTitle: 'Failing Inner Brain',
        status: STATUS.ERROR,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String),
        }),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.arrayContaining([
          expect.objectContaining({
            title: 'Throw error',
            status: STATUS.ERROR,
          }),
        ]),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.ERROR,
        brainTitle: 'Outer Brain',
        status: STATUS.ERROR,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String),
        }),
      }),
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.arrayContaining([
          expect.objectContaining({
            title: 'Run inner brain',
            status: STATUS.ERROR,
          }),
        ]),
      }),
    ]);

    // Find inner and outer error events by brainTitle
    // (inner brains share the same brainRunId as outer brain)
    const innerErrorEvent = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.ERROR && e.brainTitle === 'Failing Inner Brain'
    ) as BrainErrorEvent<any>;

    const outerErrorEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.ERROR && e.brainTitle === 'Outer Brain'
    ) as BrainErrorEvent<any>;

    expect(innerErrorEvent.error).toEqual(
      expect.objectContaining({
        message: 'Inner brain error',
      })
    );
    expect(outerErrorEvent.error).toEqual(
      expect.objectContaining({
        message: 'Inner brain error',
      })
    );
  });
});
