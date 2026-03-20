import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { State, JsonObject } from '../src/dsl/types.js';
import {
  brain,
  type BrainEvent,
  type BrainErrorEvent,
} from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { createWebhook } from '../src/index.js';
import {
  finalStateFromEvents,
  mockClient,
  mockResources,
} from './brain-test-helpers.js';

describe('nested brains', () => {
  it('should execute nested brains and yield all inner brain events', async () => {
    // Create an inner brain that will be nested
    const innerBrain = brain<{}, { value: number }>('Inner Brain').step(
      'Double value',
      ({ state }) => ({
        inner: true,
        value: state.value * 2,
      })
    );

    // Create outer brain that uses the inner brain
    const outerBrain = brain('Outer Brain')
      .step('Set prefix', () => ({ prefix: 'test-' }))
      .brain('Run inner brain', innerBrain, {
        initialState: { value: 5 },
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    // Verify all events are yielded in correct order
    expect(
      events.map((e) => ({
        type: e.type,
        brainTitle: 'brainTitle' in e ? e.brainTitle : undefined,
        status: 'status' in e ? e.status : undefined,
        stepTitle: 'stepTitle' in e ? e.stepTitle : undefined,
      }))
    ).toEqual([
      // Outer brain start
      {
        type: BRAIN_EVENTS.START,
        brainTitle: 'Outer Brain',
        status: STATUS.RUNNING,
        stepTitle: undefined,
      },
      // Initial step status for outer brain
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      // First step of outer brain
      {
        type: BRAIN_EVENTS.STEP_START,
        brainTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix',
      },
      // First step status (running)
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Set prefix',
      },
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      {
        type: BRAIN_EVENTS.STEP_START,
        brainTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner brain',
      },
      // Step status for inner brain (running)
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      // Inner brain start
      {
        type: BRAIN_EVENTS.START,
        brainTitle: 'Inner Brain',
        status: STATUS.RUNNING,
        stepTitle: undefined,
      },
      // Initial step status for inner brain
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      // Inner brain step
      {
        type: BRAIN_EVENTS.STEP_START,
        brainTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Double value',
      },
      // Inner brain step status (running)
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Double value',
      },
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      {
        type: BRAIN_EVENTS.COMPLETE,
        brainTitle: 'Inner Brain',
        status: STATUS.COMPLETE,
        stepTitle: undefined,
      },
      // Outer brain nested step completion
      {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainTitle: undefined,
        status: STATUS.RUNNING,
        stepTitle: 'Run inner brain',
      },
      {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainTitle: undefined,
        status: undefined,
        stepTitle: undefined,
      },
      // Outer brain completion
      {
        type: BRAIN_EVENTS.COMPLETE,
        brainTitle: 'Outer Brain',
        status: STATUS.COMPLETE,
        stepTitle: undefined,
      },
    ]);

    // Verify outer state is passed correctly (state machine handles depth scoping)
    const outerState = finalStateFromEvents(events);

    expect(outerState).toEqual({
      prefix: 'test-',
      inner: true,
      value: 10,
    });
  });

  it('should handle errors in nested brains and propagate them up', async () => {
    // Create an inner brain that will throw an error
    const innerBrain = brain<{}, { inner: boolean; value?: number }>(
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

  it('should include patches in step status events for inner brain steps', async () => {
    interface InnerState extends State {
      value: number;
    }

    interface OuterState extends State {
      value: number;
      result?: number;
    }

    // Create an inner brain that modifies state
    const innerBrain = brain<{}, InnerState>('Inner Brain').step(
      'Double value',
      ({ state }) => ({
        ...state,
        value: state.value * 2,
      })
    );

    // Create outer brain that uses the inner brain
    const outerBrain = brain<{}, OuterState>('Outer Brain')
      .step('Set initial', () => ({
        value: 5,
      }))
      .brain('Run inner brain', innerBrain, {
        initialState: ({ state }) => ({ value: state.value }),
      });

    // Run brain and collect step status events
    let finalStepStatus;
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      }
    }

    // Verify step status contains patches for all steps including the inner brain step
    expect(finalStepStatus?.steps).toEqual([
      expect.objectContaining({
        title: 'Set initial',
        status: STATUS.COMPLETE,
      }),
      expect.objectContaining({
        title: 'Run inner brain',
        status: STATUS.COMPLETE,
      }),
    ]);
  });

  it('should pass all step context params to nested brains', async () => {
    // This test ensures that when new params are added to step context,
    // they are also passed to nested brains. If someone adds a new service
    // but forgets to pass it to inner brains, this test will fail.
    //
    // We capture keys that have defined (non-undefined) values, since
    // Object.keys() includes keys even when values are undefined.
    let outerDefinedKeys: string[] = [];
    let innerDefinedKeys: string[] = [];

    const innerBrain = brain('Inner Param Brain').step(
      'Capture Inner Params',
      (params) => {
        // Capture keys that have defined values
        innerDefinedKeys = Object.entries(params)
          .filter(([_, value]) => value !== undefined)
          .map(([key]) => key)
          .sort();
        return {};
      }
    );

    const outerBrain = brain('Outer Param Brain')
      .step('Capture Outer Params', (params) => {
        // Capture keys that have defined values
        outerDefinedKeys = Object.entries(params)
          .filter(([_, value]) => value !== undefined)
          .map(([key]) => key)
          .sort();
        return {};
      })
      .brain('Run Inner', innerBrain);

    // Create mock pages service
    const mockPages = {
      create: jest.fn(),
      get: jest.fn(),
      exists: jest.fn(),
      update: jest.fn(),
    };
    const mockEnv = { origin: 'http://test.com', secrets: {} };

    for await (const _ of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      resources: mockResources,
      pages: mockPages as any,
      env: mockEnv,
    })) {
    }

    // Inner brain steps should receive the same defined params as outer brain steps
    expect(innerDefinedKeys).toEqual(outerDefinedKeys);
  });

  it('should pass brainRunId to inner brain', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner Brain').step(
      'Inner step',
      ({ state }) => ({ value: state.value * 2 })
    );

    const outerBrain = brain('Outer Brain')
      .step('Outer step', () => ({ prefix: 'test-' }))
      .brain('Run inner brain', innerBrain, {
        initialState: { value: 5 },
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      brainRunId: 'test-run-id-123',
    })) {
      events.push(event);
    }

    // All events should have the same brainRunId
    const brainRunIds = events.map((e) => e.brainRunId);
    const uniqueRunIds = [...new Set(brainRunIds)];

    expect(uniqueRunIds).toEqual(['test-run-id-123']);
  });

  it('should resume inner brain after waitFor webhook', async () => {
    // Define a webhook that the inner brain will wait for
    const testWebhook = createWebhook(
      'test-webhook',
      z.object({ data: z.string() }),
      async (request: Request) => ({
        type: 'webhook' as const,
        identifier: 'test-id',
        response: { data: 'webhook-response' },
      })
    );

    // Inner brain with a webhook wait
    const innerBrain = brain<JsonObject, { count: number }>('Inner Brain')
      .step('Inner step 1', ({ state }) => ({ count: state.count + 1 }))
      .step('Prepare wait', ({ state }) => ({
        ...state,
        waiting: true,
      }))
      .wait('Wait for webhook', () => testWebhook('test-id'))
      .handle('Process webhook', ({ state, response }) => ({
        ...state,
        webhookData: response?.data || 'no-data',
        processed: true,
      }));

    // Outer brain containing the inner brain
    const outerBrain = brain('Outer Brain')
      .step('Outer step 1', () => ({ prefix: 'outer-' }))
      .brain('Run inner brain', innerBrain, {
        initialState: { count: 0 },
      })
      .step('Outer step 2', ({ state }) => ({
        ...state,
        done: true,
      }));

    // First run - should stop at webhook in inner brain
    // Like BrainRunner, we stop consuming events when we see WEBHOOK
    const firstRunEvents: BrainEvent<any>[] = [];
    const brainRun = outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      brainRunId: 'test-run-id',
    });
    for await (const event of brainRun) {
      firstRunEvents.push(event);
      // Stop when we see WEBHOOK event (like BrainRunner does)
      if (event.type === BRAIN_EVENTS.WEBHOOK) {
        break;
      }
    }

    // Verify we got a WEBHOOK event
    const webhookEvent = firstRunEvents.find(
      (e) => e.type === BRAIN_EVENTS.WEBHOOK
    );
    expect(webhookEvent).toBeDefined();

    // Verify we stopped before outer brain COMPLETE (it's waiting)
    const outerCompleteEvent = firstRunEvents.find(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Outer Brain'
    );
    expect(outerCompleteEvent).toBeUndefined();

    // Build resume params from events using flat structure
    // Outer brain: at step 1 (the inner brain step), state after step 0
    // Inner brain: at step 3 (Process webhook), state after steps 0, 1, and 2

    // Resume with webhook response
    const resumeEvents: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      brainRunId: 'test-run-id',
      resume: {
        state: { prefix: 'outer-' }, // State after outer step 1
        stepIndex: 1, // Outer brain is at step 1 (Run inner brain)
        innerStack: [
          { state: { count: 1, waiting: true }, stepIndex: 3 }, // Inner brain resumes at step 3
        ],
        webhookResponse: { data: 'hello from webhook!' },
      },
    })) {
      resumeEvents.push(event);
    }

    // Verify the inner brain completed processing the webhook
    const innerProcessStep = resumeEvents.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Process webhook'
    );
    expect(innerProcessStep).toBeDefined();

    // Verify the outer brain completed
    const outerComplete = resumeEvents.find(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Outer Brain'
    );
    expect(outerComplete).toBeDefined();

    // Verify outer step 2 ran
    const outerStep2 = resumeEvents.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Outer step 2'
    );
    expect(outerStep2).toBeDefined();
  });
});
