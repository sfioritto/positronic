import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { State, JsonObject } from '../src/dsl/types.js';
import {
  brain,
  type BrainEvent,
  type BrainErrorEvent,
  type SerializedStep,
  type SerializedStepStatus,
} from '../src/dsl/brain.js';
import { createBrain } from '../src/dsl/create-brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import { createResources } from '../src/resources/resources.js';
import type { ResourceLoader } from '../src/resources/resource-loader.js';
import { createWebhook } from '../src/index.js';
import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';

// Helper function to get the next value from an AsyncIterator
const nextStep = async <T>(brainRun: AsyncIterator<T>): Promise<T> => {
  const result = await brainRun.next();
  if (result.done) throw new Error('Iterator is done');
  return result.value;
};

// Helper: replay events through the brain state machine to get final state.
// Handles nested brain depth tracking and patch scoping automatically.
function finalStateFromEvents(events: BrainEvent<any>[]): any {
  const sm = createBrainExecutionMachine();
  for (const event of events) {
    sendEvent(sm, event as any);
  }
  return sm.context.currentState;
}

// Define a Logger interface for testing
interface Logger {
  log: (message: string) => void;
}

// Mock services for testing
const testLogger: Logger = {
  log: jest.fn(),
};

type AssertEquals<T, U> = 0 extends 1 & T
  ? false // fails if T is any
  : 0 extends 1 & U
  ? false // fails if U is any
  : [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;

// Mock ObjectGenerator for testing
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  streamText: mockStreamText,
};

const dummyOutputSchema = z.object({ result: z.string() });
const dummyStateKey = 'agentResult' as const;

// Mock Resources for testing
const mockResourceLoad = jest.fn(
  async (
    resourceName: string,
    type?: 'text' | 'binary'
  ): Promise<string | Buffer> => {
    if (type === 'binary')
      return Buffer.from(`mock ${resourceName} binary content`);
    return `mock ${resourceName} text content`;
  }
) as jest.MockedFunction<ResourceLoader['load']>;

const mockResourceLoader: ResourceLoader = {
  load: mockResourceLoad,
};

const testManifest = {
  myFile: {
    type: 'text' as const,
    key: 'myFile',
    path: '/test/myFile.txt',
  },
  myBinaryFile: {
    type: 'binary' as const,
    key: 'myBinaryFile',
    path: '/test/myBinaryFile.bin',
  },
  nested: {
    anotherFile: {
      type: 'text' as const,
      key: 'anotherFile',
      path: '/test/anotherFile.txt',
    },
  },
} as const;
const mockResources = createResources(mockResourceLoader, testManifest);

describe('brain creation', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
    mockResourceLoad.mockClear();
  });

  it('should create a brain with steps and run through them', async () => {
    const testBrain = brain('test brain')
      .step('First step', () => {
        return { count: 1 };
      })
      .step('Second step', ({ state }) => ({
        ...state,
        doubled: state.count * 2,
      }));

    const brainRun = testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Check start event
    const startResult = await brainRun.next();
    expect(startResult.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'test brain',
        brainDescription: undefined,
      })
    );

    // Skip initial step status event
    await nextStep(brainRun);

    // Check first step start
    const firstStepStartResult = await nextStep(brainRun);
    expect(firstStepStartResult).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'First step',
        stepId: expect.any(String),
      })
    );

    // Check first step status (running)
    const firstStepStatusRunning = await nextStep(brainRun);
    expect(firstStepStatusRunning).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      })
    );
    if (firstStepStatusRunning.type === BRAIN_EVENTS.STEP_STATUS) {
      expect(firstStepStatusRunning.steps[0].status).toBe(STATUS.RUNNING);
    }

    // Check first step completion
    const firstStepResult = await nextStep(brainRun);
    expect(firstStepResult).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: 'First step',
        stepId: expect.any(String),
        patch: [
          {
            op: 'add',
            path: '/count',
            value: 1,
          },
        ],
      })
    );

    // Step Status Event
    await nextStep(brainRun);

    // Check second step start
    const secondStepStartResult = await nextStep(brainRun);
    expect(secondStepStartResult).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_START,
        status: STATUS.RUNNING,
        stepTitle: 'Second step',
        stepId: expect.any(String),
      })
    );

    // Check second step status (running)
    const secondStepStatusRunning = await nextStep(brainRun);
    expect(secondStepStatusRunning).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      })
    );
    if (secondStepStatusRunning.type === BRAIN_EVENTS.STEP_STATUS) {
      expect(secondStepStatusRunning.steps[1].status).toBe(STATUS.RUNNING);
    }

    // Check second step completion
    const secondStepResult = await nextStep(brainRun);
    expect(secondStepResult).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        stepTitle: 'Second step',
        stepId: expect.any(String),
        patch: [
          {
            op: 'add',
            path: '/doubled',
            value: 2,
          },
        ],
      })
    );

    // Step Status Event
    const stepStatusResult = await nextStep(brainRun);
    expect(stepStatusResult).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: [
          expect.objectContaining({
            title: 'First step',
            status: STATUS.COMPLETE,
            id: expect.any(String),
          }),
          expect.objectContaining({
            title: 'Second step',
            status: STATUS.COMPLETE,
            id: expect.any(String),
          }),
        ],
      })
    );

    // Check brain completion
    const completeResult = await nextStep(brainRun);
    expect(completeResult).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        brainTitle: 'test brain',
        brainDescription: undefined,
      })
    );
  });

  it('should emit webhook event and stop execution when step returns webhook', async () => {
    // Define a test webhook
    const testWebhook = createWebhook(
      'test-webhook',
      z.object({ userResponse: z.string() }),
      async (request: Request) => ({
        type: 'webhook' as const,
        identifier: 'test-id',
        response: { userResponse: 'test' },
      })
    );

    const testBrain = brain('webhook test brain')
      .step('First step', () => {
        return { count: 1 };
      })
      .wait('Webhook step', () => testWebhook('test-id'))
      .handle('Third step', ({ state }) => ({
        ...state,
        processed: true,
      }));

    const events = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    // Find the webhook event (run 1)
    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.WEBHOOK,
        waitFor: [
          {
            slug: 'test-webhook',
            identifier: 'test-id',
          },
        ],
        brainRunId: expect.any(String),
        options: {},
      })
    );

    // Verify that all steps completed when running brain directly
    const stepCompleteEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
    );
    expect(stepCompleteEvents[0].stepTitle).toBe('First step');
    expect(stepCompleteEvents[1].stepTitle).toBe('Webhook step');

    // The webhook step should have an empty patch since state didn't change
    expect(stepCompleteEvents[1].patch).toEqual([]);

    // Verify webhook event comes after webhook step completion
    const webhookStepCompleteIndex = events.findIndex(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE && e.stepTitle === 'Webhook step'
    );
    const webhookEventIndex = events.findIndex(
      (e) => e.type === BRAIN_EVENTS.WEBHOOK
    );
    expect(webhookEventIndex).toBeGreaterThan(webhookStepCompleteIndex);

    // When running brain directly (not through runner), all steps execute
    // The third step should have started and completed
    const thirdStepStart = events.find(
      (e) => e.type === BRAIN_EVENTS.STEP_START && e.stepTitle === 'Third step'
    );
    expect(thirdStepStart).toBeDefined();

    // Verify brain completes normally
    const completeEvent = events.find((e) => e.type === BRAIN_EVENTS.COMPLETE);
    expect(completeEvent).toBeDefined();

    // All three steps should have completed
    expect(stepCompleteEvents).toHaveLength(3);
    expect(stepCompleteEvents[2].stepTitle).toBe('Third step');
  });

  it('should create a brain with a name and description when passed an object', async () => {
    const testBrain = brain({
      title: 'my named brain',
      description: 'some description',
    });

    const brainRun = testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    });
    const startResult = await brainRun.next();
    expect(startResult.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'my named brain',
        brainDescription: 'some description',
        options: {},
      })
    );
  });

  it('should create a brain with just a name when passed a string', async () => {
    const testBrain = brain('simple brain');
    const brainRun = testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    });
    const startResult = await brainRun.next();
    expect(startResult.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'simple brain',
        brainDescription: undefined,
        options: {},
      })
    );
  });

  it('should allow overriding client per step', async () => {
    const overrideClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest
        .fn<ObjectGenerator['generateObject']>()
        .mockResolvedValue({ object: { override: true } }),
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    // Make sure that for the default prompt the default client returns a known value.
    mockClient.generateObject.mockResolvedValueOnce({
      object: { override: false },
    });

    const testBrain = brain('Client Override Test')
      .prompt('Use default client', {
        template: () => 'prompt1',
        outputSchema: z.object({ override: z.boolean() }),
      })
      .prompt('Use override client', {
        template: () => 'prompt2',
        outputSchema: z.object({ override: z.boolean() }),
        client: overrideClient,
      });

    // Run the brain and capture all events
    const events = [];
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Final state should include both responses (spread flat, second prompt overrides first)
    expect(finalState).toEqual({
      override: true,
    });

    // Verify that each client was used correctly based on the supplied prompt configuration.
    expect(mockClient.generateObject).toHaveBeenCalledWith({
      schema: expect.any(z.ZodObject),
      prompt: 'prompt1',
    });
    expect(overrideClient.generateObject).toHaveBeenCalledWith({
      schema: expect.any(z.ZodObject),
      prompt: 'prompt2',
    });

    // Verify that the state was updated correctly with values from both clients.
  });

  it('should use a plain ObjectGenerator override on prompt step', async () => {
    const overrideClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest
        .fn<ObjectGenerator['generateObject']>()
        .mockResolvedValue({ object: { derived: true } }),
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    const testBrain = brain('Client Plain Override Test').prompt(
      'Use override client',
      {
        template: () => 'prompt1',
        outputSchema: z.object({ derived: z.boolean() }),
        client: overrideClient,
      }
    );

    const events = [];
    let finalState: any = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // The override client should have been used for the prompt call
    expect(overrideClient.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'prompt1' })
    );

    // The runner's client should NOT have been called
    expect(mockClient.generateObject).not.toHaveBeenCalled();

    // State should reflect the override client's response (spread flat)
    expect(finalState).toEqual({ derived: true });
  });

  it('should use the provided brainRunId for the initial run if supplied', async () => {
    const testBrain = brain('Brain with Provided ID');
    const providedId = 'my-custom-run-id-123';

    const brainRun = testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      brainRunId: providedId,
    });

    // Check start event
    const startResult = await brainRun.next();
    expect(startResult.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'Brain with Provided ID',
        brainRunId: providedId, // Expect the provided ID here
      })
    );
  });

  describe('Resource Availability in Steps', () => {
    it('should make resources available in a simple step action', async () => {
      let loadedText: string | undefined;
      const testBrain = brain('Resource Step Test').step(
        'Load My File',
        async ({ resources }) => {
          loadedText = await (resources.myFile as any).loadText();
          return { loadedText };
        }
      );

      const run = testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        resources: mockResources,
      });
      // Iterate through to completion
      for await (const _ of run) {
      }

      expect(mockResourceLoad).toHaveBeenCalledWith('myFile', 'text');
      expect(loadedText).toBe('mock myFile text content');
    });

    it('should pass resources to prompt template function', async () => {
      const testBrain = brain('Resource Prompt Template Test').prompt(
        'Generate Summary',
        {
          template: async ({ state, resources }) => {
            const templateContent = await (resources.myFile as any).loadText();
            return `Generate a summary for: ${templateContent}`;
          },
          outputSchema: z.object({ summary: z.string() }),
        }
      );

      mockGenerateObject.mockResolvedValue({
        object: { summary: 'Test summary' },
      });

      const run = testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        resources: mockResources,
      });

      let finalState: any = {};
      for await (const event of run) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      // Verify resource was loaded in template
      expect(mockResourceLoad).toHaveBeenCalledWith('myFile', 'text');

      // Verify the generated prompt included the resource content
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Generate a summary for: mock myFile text content',
        })
      );

      // Verify final state (spread flat)
      expect(finalState).toEqual({
        summary: 'Test summary',
      });
    });

    it('templates can use state', async () => {
      const testBrain = brain('State Template Test')
        .step('Set Data', () => ({ existingData: 'legacy data' }))
        .prompt('Analyze Data', {
          template: ({ state }) => {
            return `Analyze this: ${state.existingData}`;
          },
          outputSchema: z.object({ analysis: z.string() }),
        });

      mockGenerateObject.mockResolvedValue({
        object: { analysis: 'Analysis result' },
      });

      const run = testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        resources: mockResources,
      });

      let finalState: any = {};
      for await (const event of run) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      // Verify the prompt was generated correctly
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Analyze this: legacy data',
        })
      );

      // Verify final state (spread flat)
      expect(finalState).toEqual({
        existingData: 'legacy data',
        analysis: 'Analysis result',
      });

      // Verify no resources were loaded (since template didn't use them)
      expect(mockResourceLoad).not.toHaveBeenCalled();
    });

    it('should make resources available in a nested brain step', async () => {
      let nestedLoadedText: string | undefined;

      const innerBrain = brain('Inner Resource Brain').step(
        'Inner Load Step',
        async ({ resources }) => {
          nestedLoadedText = await (resources.myBinaryFile as any)
            .loadBinary()
            .then((b: Buffer) => b.toString());
          return { nestedLoadedText };
        }
      );

      const outerBrain = brain('Outer Resource Brain').brain(
        'Run Inner',
        innerBrain
      );

      const run = outerBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        resources: mockResources,
      });
      for await (const _ of run) {
      }

      expect(mockResourceLoad).toHaveBeenCalledWith('myBinaryFile', 'binary');
      expect(nestedLoadedText).toBe('mock myBinaryFile binary content');
    });
  });
});

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

describe('brain resumption', () => {
  const mockClient = {
    generateObject: jest.fn(),
    streamText: jest.fn(),
  };

  it('should resume brain from the correct step when given resumeContext', async () => {
    const executedSteps: string[] = [];
    const threeStepBrain = brain('Three Step Brain')
      .step('Step 1', ({ state }) => {
        executedSteps.push('Step 1');
        return { ...state, value: 2 };
      })
      .step('Step 2', ({ state }) => {
        executedSteps.push('Step 2');
        return { ...state, value: state.value + 10 };
      })
      .step('Step 3', ({ state }) => {
        executedSteps.push('Step 3');
        return { ...state, value: state.value * 3 };
      });

    // First run to get the first step completed with initial state
    const initialState = { initialValue: true };
    let stateAfterStep1: State = initialState;

    // Run brain until we get the first step completed
    for await (const event of threeStepBrain.run({
      client: mockClient as ObjectGenerator,
      currentUser: { name: 'test-user' },
      initialState,
    })) {
      if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        event.stepTitle === 'Step 1'
      ) {
        stateAfterStep1 = applyPatches(stateAfterStep1, [event.patch]);
        break; // Stop after first step
      }
    }

    // Clear executed steps array
    executedSteps.length = 0;

    // Resume brain from step 1 (stepIndex = 1 means we start at step 2)
    // with the state after step 1 completed
    let resumedState: State = stateAfterStep1;

    for await (const event of threeStepBrain.run({
      client: mockClient as ObjectGenerator,
      currentUser: { name: 'test-user' },
      resume: {
        state: stateAfterStep1,
        stepIndex: 1, // Resume from step index 1 (Step 2)
      },
      brainRunId: 'test-run-id',
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        resumedState = applyPatches(resumedState, [event.patch]);
      }
    }

    // Verify only steps 2 and 3 were executed
    expect(executedSteps).toEqual(['Step 2', 'Step 3']);
    expect(executedSteps).not.toContain('Step 1');

    // Verify the final state after all steps complete
    expect(resumedState).toEqual({
      value: 36,
      initialValue: true,
    });
  });
});

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

describe('brain options', () => {
  it('should pass options through to brain events', async () => {
    const optionsSchema = z.object({
      testOption: z.string(),
    });

    const testBrain = brain('Options Brain')
      .withOptionsSchema(optionsSchema)
      .step('Simple step', ({ state, options }) => ({
        value: 1,
        passedOption: options.testOption,
      }));

    const brainOptions = {
      testOption: 'test-value',
    };

    let finalEvent, finalStepStatus;
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      options: brainOptions,
    })) {
      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      } else {
        finalEvent = event;
      }
    }

    expect(finalEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        brainTitle: 'Options Brain',
        brainDescription: undefined,
        options: brainOptions,
      })
    );
    expect(finalStepStatus).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: [
          expect.objectContaining({
            title: 'Simple step',
            status: STATUS.COMPLETE,
          }),
        ],
        options: brainOptions,
      })
    );
  });

  it('should provide empty object as default options', async () => {
    const testBrain = brain('Default Options Brain').step(
      'Simple step',
      ({ options }) => ({
        hasOptions: Object.keys(options).length === 0,
      })
    );

    const brainRun = testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Skip start event
    await brainRun.next();

    // Skip initial step status event
    await brainRun.next();

    // Check step start
    const stepStartResult = await brainRun.next();
    expect(stepStartResult.value).toEqual(
      expect.objectContaining({
        options: {},
        type: BRAIN_EVENTS.STEP_START,
      })
    );

    // Check step status (running) (options test)
    const stepStatusRunning = await brainRun.next();
    expect(stepStatusRunning.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: expect.any(Array),
      })
    );
    if (stepStatusRunning.value.type === BRAIN_EVENTS.STEP_STATUS) {
      expect(stepStatusRunning.value.steps[0].status).toBe(STATUS.RUNNING);
    }

    // Check step completion
    const stepResult = await brainRun.next();
    expect(stepResult.value).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        stepTitle: 'Simple step',
        options: {},
      })
    );
  });
});

describe('services support', () => {
  it('should allow adding custom services to brains', async () => {
    // Create a brain with services
    const testBrain = brain('Services Test')
      .withServices({
        logger: testLogger,
      })
      .step('Use service', ({ state, logger }) => {
        logger.log('Test service called');
        return { serviceUsed: true };
      });

    // Run the brain and collect events
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the service was called
    expect(testLogger.log).toHaveBeenCalledWith('Test service called');

    // Verify the state was updated
    expect(finalState).toEqual({ serviceUsed: true });
  });

  it('should propagate services from parent to child brain', async () => {
    let childReceivedApi: string | undefined;

    const childBrain = brain('Child Brain').step(
      'Use parent service',
      (params: any) => {
        childReceivedApi = params.api;
        return { childDone: true };
      }
    );

    const parentBrain = brain('Parent Brain')
      .withServices({ api: 'parent-api-url' })
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain as any);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
    }

    expect(childReceivedApi).toBe('parent-api-url');
  });

  it('should allow child services to override parent services', async () => {
    let childReceivedApi: string | undefined;

    const childBrain = brain('Override Child')
      .withServices({ api: 'child-api-url' })
      .step('Use service', (params: any) => {
        childReceivedApi = params.api;
        return { childDone: true };
      });

    const parentBrain = brain('Override Parent')
      .withServices({ api: 'parent-api-url' })
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
    }

    // Child's own withServices() should win over parent's
    expect(childReceivedApi).toBe('child-api-url');
  });

  it('should make parent services available to child without withServices', async () => {
    let childReceivedLogger: any;

    const childBrain = brain('No Services Child').step(
      'Check for service',
      (params: any) => {
        childReceivedLogger = params.logger;
        return { checked: true };
      }
    );

    const parentBrain = brain('Provides Services Parent')
      .withServices({ logger: testLogger })
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain as any);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
    }

    expect(childReceivedLogger).toBe(testLogger);
  });

  it('should propagate storeProvider to nested brains', async () => {
    const storeData = new Map<string, any>();
    const mockStoreProvider = (config: any) => ({
      get: async (key: string) => storeData.get(`${config.brainTitle}:${key}`),
      set: async (key: string, value: any) => {
        storeData.set(`${config.brainTitle}:${key}`, value);
      },
      delete: async (key: string) => {
        storeData.delete(`${config.brainTitle}:${key}`);
      },
      has: async (key: string) => storeData.has(`${config.brainTitle}:${key}`),
    });

    const childBrain = brain('Store Child')
      .withStore({ counter: z.number() })
      .step('Write store', async ({ store }) => {
        await store!.set('counter', 42);
        return { stored: true };
      });

    const parentBrain = brain('Store Parent')
      .step('Init', () => ({ started: true }))
      .brain('Run child', childBrain as any);

    for await (const _ of parentBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      storeProvider: mockStoreProvider,
    })) {
    }

    expect(storeData.get('Store Child:counter')).toBe(42);
  });
});

describe('type inference', () => {
  it('should correctly infer complex brain state types', async () => {
    // Create an inner brain that uses the shared options type
    const optionsSchema = z.object({
      features: z.array(z.string()),
    });

    const innerBrain = brain('Inner Type Test')
      .withOptionsSchema(optionsSchema)
      .step('Process features', ({ options }) => ({
        processedValue: options.features.includes('fast') ? 100 : 42,
        featureCount: options.features.length,
      }));

    // Create a complex brain using multiple features
    const complexBrain = brain('Complex Type Test')
      .withOptionsSchema(optionsSchema)
      .step('First step', ({ options }) => ({
        initialFeatures: options.features,
        value: 42,
      }))
      .brain('Nested brain', innerBrain, {
        initialState: {
          processedValue: 0,
          featureCount: 0,
        },
        options: ({ options }) => options,
      })
      .step('Final step', ({ state }) => ({
        ...state,
        completed: true as const,
      }));

    // Type test setup
    type ExpectedState = {
      initialFeatures: string[];
      value: number;
      processedValue: number;
      featureCount: number;
      completed: true;
    };

    type ActualState = Parameters<
      Parameters<(typeof complexBrain)['step']>[1]
    >[0]['state'];

    type TypeTest = AssertEquals<ActualState, ExpectedState>;
    const _typeAssert: TypeTest = true;

    // Collect all events
    const events = [];
    let finalStepStatus;
    let mainBrainId: string | undefined;

    for await (const event of complexBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      options: { features: ['fast', 'secure'] },
    })) {
      events.push(event);

      // Capture the main brain's ID from its start event
      if (event.type === BRAIN_EVENTS.START && !mainBrainId) {
        mainBrainId = event.brainRunId;
      }

      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      }
    }
    const finalState = finalStateFromEvents(events);

    // Verify brain start event
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'Complex Type Test',
        brainDescription: undefined,
        options: { features: ['fast', 'secure'] },
        brainRunId: mainBrainId,
      })
    );

    // Verify inner brain events are included (inner brains share brainRunId with outer)
    const innerStartEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.START && e.brainTitle === 'Inner Type Test'
    );
    expect(innerStartEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle: 'Inner Type Test',
        options: { features: ['fast', 'secure'] },
      })
    );

    // Verify the final step status
    if (!finalStepStatus) throw new Error('Expected final step status event');
    const lastStep = finalStepStatus.steps[finalStepStatus.steps.length - 1];
    expect(lastStep.status).toBe(STATUS.COMPLETE);
    expect(lastStep.title).toBe('Final step');

    expect(finalState).toEqual({
      initialFeatures: ['fast', 'secure'],
      value: 42,
      processedValue: 100,
      featureCount: 2,
      completed: true,
    });
  });

  it('should correctly infer brain outputKey state types', async () => {
    // Create an inner brain with a specific state shape
    const innerBrain = brain('Inner State Test').step('Inner step', () => ({
      innerValue: 42,
      metadata: { processed: true as const },
    }));

    // Create outer brain to test outputKey type inference
    const outerBrain = brain('Outer State Test')
      .step('First step', () => ({
        outerValue: 100,
        status: 'ready',
      }))
      .brain('Nested brain', innerBrain)
      .step('Verify types', ({ state }) => {
        // Type assertion for merged state (inner brain state spread flat)
        type ExpectedState = {
          outerValue: number;
          status: string;
          innerValue: number;
          metadata: { processed: true };
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return state;
      });

    // Run the brain to verify runtime behavior
    const events = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }
    const finalState = finalStateFromEvents(events);

    expect(finalState).toEqual({
      outerValue: 100,
      status: 'ready',
      innerValue: 42,
      metadata: { processed: true },
    });
  });

  it('should pass independent options to inner brain', async () => {
    // Inner brain has its own options schema, different from the parent
    const innerBrain = brain('Independent Options Inner')
      .withOptionsSchema(z.object({ multiplier: z.number() }))
      .step('Multiply', ({ state, options }) => ({
        result: (state as any).value * options.multiplier,
      }));

    // Outer brain has a completely different options schema
    const outerBrain = brain('Independent Options Outer')
      .withOptionsSchema(z.object({ label: z.string() }))
      .step('Init', ({ options }) => ({
        value: 10,
        label: options.label,
      }))
      .brain('Compute', innerBrain, {
        initialState: ({ state }) => ({ value: state.value }),
        options: { multiplier: 3 },
      })
      .step('Final', ({ state }) => ({
        ...state,
        done: true,
      }));

    const events = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      options: { label: 'test' },
    })) {
      events.push(event);
    }
    const finalState = finalStateFromEvents(events);

    expect(finalState).toEqual({
      value: 10,
      label: 'test',
      result: 30,
      done: true,
    });

    // Verify inner brain received its own options, not the parent's
    const innerStartEvent = events.find(
      (e: any) =>
        e.type === BRAIN_EVENTS.START &&
        e.brainTitle === 'Independent Options Inner'
    );
    expect(innerStartEvent).toEqual(
      expect.objectContaining({
        options: { multiplier: 3 },
      })
    );
  });

  it('should correctly infer step action state types', async () => {
    const testBrain = brain('Action State Test')
      .step('First step', () => ({
        count: 1,
        metadata: { created: new Date().toISOString() },
      }))
      .step('Second step', ({ state }) => {
        // Type assertion for action state
        type ExpectedState = {
          count: number;
          metadata: { created: string };
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return {
          ...state,
          count: state.count + 1,
          metadata: {
            ...state.metadata,
            updated: new Date().toISOString(),
          },
        };
      });

    // Run the brain to verify runtime behavior
    const events = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }
    const finalState = finalStateFromEvents(events);

    expect(finalState).toMatchObject({
      count: 2,
      metadata: {
        created: expect.any(String),
        updated: expect.any(String),
      },
    });
  });

  it('should correctly infer prompt response types in subsequent steps', async () => {
    const testBrain = brain('Prompt Type Test')
      .prompt('Get user info', {
        template: () => "What is the user's info?",
        outputSchema: z.object({ name: z.string(), age: z.number() }),
      })
      .step('Use response', ({ state }) => {
        // Type assertion to verify state includes prompt result spread flat
        type ExpectedState = {
          name: string;
          age: number;
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return {
          ...state,
          greeting: `Hello ${state.name}, you are ${state.age} years old`,
        };
      });

    // Mock the client response
    mockClient.generateObject.mockResolvedValueOnce({
      object: { name: 'Test User', age: 30 },
    });

    // Run brain and collect final state
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the brain executed correctly (prompt result spread flat)
    expect(finalState).toEqual({
      name: 'Test User',
      age: 30,
      greeting: 'Hello Test User, you are 30 years old',
    });
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

describe('.map()', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
  });

  // Helper: run brain, feed events into state machine, return { events, finalState }
  const runWithStateMachine = async (brainInstance: any, runParams: any) => {
    const sm = createBrainExecutionMachine();
    const events: BrainEvent<any>[] = [];
    for await (const event of brainInstance.run(runParams)) {
      events.push(event);
      sendEvent(sm, event as any);
    }
    return { events, finalState: sm.context.currentState as any, sm };
  };

  it('should run inner brain per item and collect results as tuples', async () => {
    const innerBrain = brain<{}, { value: number }>('Doubler').step(
      'Double',
      ({ state }) => ({ value: state.value * 2 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        items: [{ n: 3 }, { n: 5 }, { n: 7 }],
      }))
      .map('Process Items', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item, state) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.results).toHaveLength(3);
    expect(finalState.results[0]).toEqual([{ n: 3 }, { value: 6 }]);
    expect(finalState.results[1]).toEqual([{ n: 5 }, { value: 10 }]);
    expect(finalState.results[2]).toEqual([{ n: 7 }, { value: 14 }]);
  });

  it('should forward inner brain events', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value + 1 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    const { events } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Should see inner brain START events for each item
    const innerStarts = events.filter(
      (e) =>
        e.type === BRAIN_EVENTS.START &&
        'brainTitle' in e &&
        e.brainTitle === 'Inner'
    );
    expect(innerStarts).toHaveLength(2);

    // Should see inner brain COMPLETE events for each item
    const innerCompletes = events.filter(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Inner'
    );
    expect(innerCompletes).toHaveLength(2);

    // Should see STEP_COMPLETE for inner brain steps
    const innerStepCompletes = events.filter(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Process'
    );
    expect(innerStepCompletes).toHaveLength(2);
  });

  it('should emit ITERATE_ITEM_COMPLETE per item', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value * 10 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    const { events } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    const iterateEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );

    expect(iterateEvents).toHaveLength(3);
    expect((iterateEvents[0] as any).itemIndex).toBe(0);
    expect((iterateEvents[0] as any).processedCount).toBe(1);
    expect((iterateEvents[0] as any).totalItems).toBe(3);
    expect((iterateEvents[0] as any).result).toEqual({ value: 10 });
    expect((iterateEvents[0] as any).stateKey).toBe('results');

    expect((iterateEvents[1] as any).itemIndex).toBe(1);
    expect((iterateEvents[1] as any).processedCount).toBe(2);
    expect((iterateEvents[1] as any).result).toEqual({ value: 20 });

    expect((iterateEvents[2] as any).itemIndex).toBe(2);
    expect((iterateEvents[2] as any).processedCount).toBe(3);
    expect((iterateEvents[2] as any).result).toEqual({ value: 30 });
  });

  it('should use error handler as fallback when item fails', async () => {
    let callCount = 0;
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => {
        callCount++;
        if (callCount === 2) throw new Error('Item 2 failed');
        return { value: state.value * 2 };
      }
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
        error: (item, err) => ({ value: -1 }),
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    ) as any[];
    expect(itemEvents).toHaveLength(3);
    expect(itemEvents[0].result).toEqual({ value: 2 });
    expect(itemEvents[1].result).toEqual({ value: -1 }); // fallback
    expect(itemEvents[2].result).toEqual({ value: 6 });
  });

  it('should skip item when error handler returns null', async () => {
    let callCount = 0;
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => {
        callCount++;
        if (callCount === 2) throw new Error('Skip me');
        return { value: state.value };
      }
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
        error: () => null,
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    ) as any[];
    expect(itemEvents).toHaveLength(3);
    // Item 2 has undefined result (skipped)
    expect(itemEvents[0].result).toEqual({ value: 1 });
    expect(itemEvents[1].result).toBeUndefined();
    expect(itemEvents[2].result).toEqual({ value: 3 });
  });

  it('should stop on PAUSE between items', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value })
    );

    let controlSignalCallCount = 0;
    const mockSignalProvider = {
      getSignals: async (filter: string) => {
        if (filter === 'CONTROL') {
          controlSignalCallCount++;
          // 1 = main loop before Init
          // 2 = main loop before map step
          // 3 = map before first item
          // 4 = map before second item — PAUSE here
          if (controlSignalCallCount === 4) {
            return [{ type: 'PAUSE' as const }];
          }
        }
        if (filter === 'WEBHOOK') return [];
        return [];
      },
    };

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      signalProvider: mockSignalProvider,
    })) {
      events.push(event);
    }

    // Should have processed 1 item before PAUSE stopped
    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );
    expect(itemEvents).toHaveLength(1);

    // No PAUSED event (silent stop for backend restart)
    expect(events.some((e) => e.type === BRAIN_EVENTS.PAUSED)).toBe(false);

    // No outer brain COMPLETE event (inner brain completes are expected)
    const outerComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Outer'
    );
    expect(outerComplete).toBeUndefined();
  });

  it('should stop on KILL signal', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Process',
      ({ state }) => ({ value: state.value })
    );

    let controlSignalCallCount = 0;
    const mockSignalProvider = {
      getSignals: async (filter: string) => {
        if (filter === 'CONTROL') {
          controlSignalCallCount++;
          if (controlSignalCallCount === 4) {
            return [{ type: 'KILL' as const }];
          }
        }
        if (filter === 'WEBHOOK') return [];
        return [];
      },
    };

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      signalProvider: mockSignalProvider,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === BRAIN_EVENTS.CANCELLED)).toBe(true);
    // No outer brain COMPLETE event
    const outerComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.COMPLETE &&
        'brainTitle' in e &&
        e.brainTitle === 'Outer'
    );
    expect(outerComplete).toBeUndefined();
  });

  it('should throw on inner brain webhook', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner')
      .step('Process', ({ state }) => state)
      .wait('Wait for webhook', () => ({
        slug: 'test',
        identifier: 'test-id',
        schema: z.object({ data: z.string() }),
        token: 'token',
      }))
      .handle('After webhook', ({ state }) => state);

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }] }))
      .map('Iterate', {
        run: innerBrain as any,
        over: ({ state }: any) => state.items,
        initialState: (item: any) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    let error: Error | undefined;
    try {
      for await (const event of outerBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
      })) {
        // consume events
      }
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message).toContain(
      'Webhook/wait inside .map() is not supported'
    );
  });

  it('should resume from iterateProgress', async () => {
    const innerBrain = brain<{}, { value: number }>('Inner').step(
      'Double',
      ({ state }) => ({ value: state.value * 2 })
    );

    const outerBrain = brain('Outer')
      .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }))
      .map('Iterate', {
        run: innerBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ value: item.n }),
        stateKey: 'results' as const,
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      resume: {
        state: { items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] },
        stepIndex: 1,
        iterateProgress: {
          accumulatedResults: [
            [{ n: 1 }, { value: 2 }],
            [{ n: 2 }, { value: 4 }],
            undefined,
            undefined,
          ],
          processedCount: 2,
          totalItems: 4,
          stateKey: 'results',
        },
      },
      brainRunId: 'test-resume',
    })) {
      events.push(event);
    }

    // Should only have processed 2 remaining items
    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );
    expect(itemEvents).toHaveLength(2);
    expect((itemEvents[0] as any).itemIndex).toBe(2);
    expect((itemEvents[0] as any).processedCount).toBe(3);
    expect((itemEvents[1] as any).itemIndex).toBe(3);
    expect((itemEvents[1] as any).processedCount).toBe(4);

    // Verify all 4 results present in the outer step complete patch
    const outerStepComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Iterate'
    );
    expect(outerStepComplete).toBeDefined();
  });

  // Helper: creates an agent client where odd calls return a non-terminal tool
  // call and even calls return the terminal 'done' tool call. The non-terminal
  // tool's execute function throws on the Nth invocation (controlled by caller).
  function createAgentWithThrowingTool(
    shouldThrow: (callCount: number) => boolean
  ) {
    const agentGenerateText =
      jest.fn<NonNullable<ObjectGenerator['generateText']>>();
    let agentCallCount = 0;
    agentGenerateText.mockImplementation(async () => {
      agentCallCount++;
      if (agentCallCount % 2 === 1) {
        return {
          text: undefined,
          toolCalls: [
            {
              toolCallId: `call-${agentCallCount}`,
              toolName: 'crawl',
              args: { url: 'http://example.com' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        };
      }
      return {
        text: undefined,
        toolCalls: [
          {
            toolCallId: `call-${agentCallCount}`,
            toolName: 'done',
            args: { result: 'finished' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      };
    });

    let crawlCallCount = 0;
    const tools = {
      crawl: {
        description: 'Crawl a URL',
        inputSchema: z.object({ url: z.string() }),
        execute: async () => {
          crawlCallCount++;
          if (shouldThrow(crawlCallCount)) {
            throw new Error('Service unavailable: 503');
          }
          return { content: 'page content' };
        },
      },
      done: {
        description: 'Done',
        inputSchema: z.object({ result: z.string() }),
        terminal: true,
      },
    };

    const client: jest.Mocked<ObjectGenerator> = {
      generateObject: mockGenerateObject,
      generateText: agentGenerateText,
      streamText: mockStreamText,
    };

    return { client, tools };
  }

  // Helper: signal provider that PAUSEs on the Nth CONTROL signal check.
  function createPausingSignalProvider(pauseOnCall: number) {
    let controlSignalCallCount = 0;
    return {
      getSignals: async (filter: string) => {
        if (filter === 'CONTROL') {
          controlSignalCallCount++;
          if (controlSignalCallCount === pauseOnCall) {
            return [{ type: 'PAUSE' as const }];
          }
        }
        return [];
      },
    };
  }

  it.each([
    {
      label: 'step throws',
      makeInnerBrain: () => {
        let callCount = 0;
        return brain<{}, { value: number }>('FailInner').step(
          'Process',
          ({ state }) => {
            callCount++;
            if (callCount === 2) throw new Error('Item 2 exploded');
            return { value: state.value * 2 };
          }
        );
      },
      makeOuterBrain: (innerBrain: any) =>
        brain('StackOuter')
          .step('Init', () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }))
          .map('Iterate', {
            run: innerBrain,
            over: ({ state }) => state.items,
            initialState: (item: any) => ({ value: item.n }),
            stateKey: 'results' as const,
            error: () => ({ value: -1 }),
          }),
      clientOverride: undefined as any,
    },
    {
      label: 'agent throws mid-execution',
      makeInnerBrain: () => {
        const { tools } = createAgentWithThrowingTool((n) => n === 2);
        return brain<{}, { url: string }>('AgentInner').brain(
          'Crawl page',
          ({ state }) => ({
            prompt: `Crawl ${state.url}`,
            tools,
            maxIterations: 2,
            outputSchema: dummyOutputSchema,
            stateKey: dummyStateKey,
          })
        );
      },
      makeOuterBrain: (innerBrain: any) =>
        brain('AgentStackOuter')
          .step('Init', () => ({
            items: [{ url: 'a.com' }, { url: 'b.com' }, { url: 'c.com' }],
          }))
          .map('Iterate', {
            run: innerBrain,
            over: ({ state }) => state.items,
            initialState: (item: any) => ({ url: item.url }),
            stateKey: 'results' as const,
            error: () => null,
          }),
      clientOverride: () => createAgentWithThrowingTool((n) => n === 2).client,
    },
    {
      label: 'nested brain-inside-brain agent throws',
      makeInnerBrain: () => {
        const { tools } = createAgentWithThrowingTool((n) => n === 2);
        return brain<{}, { url: string }>('NestedAgentInner')
          .brain('Crawl page', ({ state }) => ({
            prompt: `Crawl ${state.url}`,
            tools,
            maxIterations: 2,
            outputSchema: dummyOutputSchema,
            stateKey: dummyStateKey,
          }))
          .step('Verify', ({ state }) => state);
      },
      makeOuterBrain: (innerBrain: any) =>
        brain('NestedAgentStackOuter')
          .step('Init', () => ({
            items: [{ url: 'a.com' }, { url: 'b.com' }, { url: 'c.com' }],
          }))
          .map('Iterate', {
            run: innerBrain,
            over: ({ state }) => state.items,
            initialState: (item: any) => ({ url: item.url }),
            stateKey: 'results' as const,
            error: () => null,
          }),
      clientOverride: () => createAgentWithThrowingTool((n) => n === 2).client,
    },
  ])(
    'should keep execution stack balanced when $label',
    async ({ makeInnerBrain, makeOuterBrain, clientOverride }) => {
      const signalProvider = createPausingSignalProvider(5);
      const innerBrain = makeInnerBrain();
      const outerBrain = makeOuterBrain(innerBrain);
      const client = clientOverride ? clientOverride() : mockClient;

      const { events, sm } = await runWithStateMachine(outerBrain, {
        client,
        currentUser: { name: 'test-user' },
        signalProvider,
      });

      const itemEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
      );
      expect(itemEvents).toHaveLength(2);

      expect(sm.context.executionStack).toHaveLength(1);
      expect(sm.context.executionStack[0].stepIndex).toBe(1);
      expect(sm.context.iterateContext).not.toBeNull();
      expect(sm.context.iterateContext!.processedCount).toBe(2);
      expect(sm.context.iterateContext!.totalItems).toBe(3);
    }
  );

  it('should run prompt per item in prompt mode', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { category: 'work', priority: 'high' },
      })
      .mockResolvedValueOnce({
        object: { category: 'personal', priority: 'low' },
      });

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        emails: [
          { subject: 'Meeting tomorrow', from: 'boss@work.com' },
          { subject: 'Weekend plans', from: 'friend@home.com' },
        ],
      }))
      .map('Categorize', {
        template: ({ item }: { item: { subject: string; from: string } }) =>
          `Categorize: ${item.subject} from ${item.from}`,
        outputSchema: z.object({
          category: z.string(),
          priority: z.enum(['high', 'medium', 'low']),
        }),
        over: ({ state }) => state.emails,
        stateKey: 'categories' as const,
      });

    const { finalState, events } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Results are IterateResult tuples
    expect(finalState.categories).toHaveLength(2);
    expect(finalState.categories[0]).toEqual([
      { subject: 'Meeting tomorrow', from: 'boss@work.com' },
      { category: 'work', priority: 'high' },
    ]);
    expect(finalState.categories[1]).toEqual([
      { subject: 'Weekend plans', from: 'friend@home.com' },
      { category: 'personal', priority: 'low' },
    ]);

    // Should emit ITERATE_ITEM_COMPLETE for each item
    const itemEvents = events.filter(
      (e) => e.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE
    );
    expect(itemEvents).toHaveLength(2);

    // No inner brain events (no START/COMPLETE from inner brain)
    const innerBrainStarts = events.filter(
      (e) => e.type === BRAIN_EVENTS.START && (e as any).brainTitle !== 'Outer'
    );
    expect(innerBrainStarts).toHaveLength(0);

    // generateObject called twice
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('should handle errors in prompt mode with error callback', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: { summary: 'Good result' },
      })
      .mockRejectedValueOnce(new Error('LLM error'))
      .mockResolvedValueOnce({
        object: { summary: 'Another result' },
      });

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        items: ['a', 'b', 'c'],
      }))
      .map('Summarize', {
        template: ({ item }: { item: string }) => `Summarize: ${item}`,
        outputSchema: z.object({ summary: z.string() }),
        over: ({ state }) => state.items,
        stateKey: 'summaries' as const,
        error: () => ({ summary: 'fallback' }),
      });

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.summaries).toHaveLength(3);
    expect(finalState.summaries[0]).toEqual(['a', { summary: 'Good result' }]);
    expect(finalState.summaries[1]).toEqual(['b', { summary: 'fallback' }]);
    expect(finalState.summaries[2]).toEqual([
      'c',
      { summary: 'Another result' },
    ]);
  });

  it('should use per-step client override in prompt mode', async () => {
    const customMockGenerateObject =
      jest.fn<ObjectGenerator['generateObject']>();
    const customClient: jest.Mocked<ObjectGenerator> = {
      generateObject: customMockGenerateObject,
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    customMockGenerateObject.mockResolvedValue({
      object: { result: 'from custom client' },
    });

    const outerBrain = brain('Outer')
      .step('Init', () => ({
        items: [{ n: 1 }],
      }))
      .map('Process', {
        template: ({ item }: { item: { n: number } }) => `Process: ${item.n}`,
        outputSchema: z.object({ result: z.string() }),
        client: customClient,
        over: ({ state }) => state.items,
        stateKey: 'results' as const,
      });

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    // Custom client was used, not the default one
    expect(customMockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(finalState.results[0]).toEqual([
      { n: 1 },
      { result: 'from custom client' },
    ]);
  });

  it('should work in brain mode when the parent brain runs as a child via .brain()', async () => {
    const processBrain = brain<{}, { value: number }>('MapChild').step(
      'Double',
      ({ state }) => ({ value: state.value * 2 })
    );

    const innerBrain = brain('MapParent')
      .step('Init', () => ({
        items: [{ value: 1 }, { value: 2 }, { value: 3 }],
      }))
      .map('Process items', {
        run: processBrain,
        over: ({ state }) => state.items,
        initialState: (item) => item,
        stateKey: 'results' as const,
        error: () => null,
      })
      .step('Summarize', ({ state }) => ({
        ...state,
        total: state.results.values.reduce(
          (sum: number, r: any) => sum + r.value,
          0
        ),
      }));

    const outerBrain = brain('MapOuter').brain('Run inner', innerBrain);

    const { finalState } = await runWithStateMachine(outerBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.total).toBe(12);
  });
});

describe('withTools vs withExtraTools semantics', () => {
  const agentMockGenerateText =
    jest.fn<NonNullable<ObjectGenerator['generateText']>>();
  const agentMockClient: jest.Mocked<ObjectGenerator> = {
    generateObject: mockGenerateObject,
    generateText: agentMockGenerateText,
    streamText: mockStreamText,
  };

  beforeEach(() => {
    mockGenerateObject.mockReset();
    agentMockGenerateText.mockReset();
  });

  // Helper to make agent immediately call done
  function setupDoneAgent() {
    agentMockGenerateText.mockResolvedValue({
      text: undefined,
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'done', args: { result: 'ok' } },
      ],
      usage: { totalTokens: 10 },
      responseMessages: [],
    });
  }

  it('withTools() replaces default tools entirely', async () => {
    setupDoneAgent();

    const myTool: any = {
      description: 'My custom tool',
      inputSchema: z.object({ x: z.string() }),
      execute: async () => 'custom result',
    };

    const testBrain = brain('tools-replace')
      .withTools({ myTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools,
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have myTool and done (auto-generated), but NOT the defaults like generateUI, consoleLog, etc.
    expect(agentStart.tools).toContain('myTool');
    expect(agentStart.tools).toContain('done');
    expect(agentStart.tools).not.toContain('generateUI');
    expect(agentStart.tools).not.toContain('consoleLog');
    expect(agentStart.tools).not.toContain('print');
    expect(agentStart.tools).not.toContain('waitForWebhook');
  });

  it('withExtraTools() adds tools alongside defaults', async () => {
    setupDoneAgent();

    const defaultTool: any = {
      description: 'A default tool',
      inputSchema: z.object({}),
      execute: async () => 'default',
    };

    const extraTool: any = {
      description: 'An extra tool',
      inputSchema: z.object({ y: z.number() }),
      execute: async () => 'extra',
    };

    const testBrain = brain('tools-extra')
      .withTools({ defaultTool })
      .withExtraTools({ extraTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools,
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have both defaultTool and extraTool plus done
    expect(agentStart.tools).toContain('defaultTool');
    expect(agentStart.tools).toContain('extraTool');
    expect(agentStart.tools).toContain('done');
  });

  it('step-level tools override both defaults and extras', async () => {
    setupDoneAgent();

    const defaultTool: any = {
      description: 'A default tool',
      inputSchema: z.object({}),
      execute: async () => 'default',
    };

    const extraTool: any = {
      description: 'An extra tool',
      inputSchema: z.object({}),
      execute: async () => 'extra',
    };

    const overrideTool: any = {
      description: 'Override of default tool',
      inputSchema: z.object({}),
      execute: async () => 'overridden',
    };

    const stepOnlyTool: any = {
      description: 'Step-only tool',
      inputSchema: z.object({}),
      execute: async () => 'step',
    };

    const testBrain = brain('tools-step-override')
      .withTools({ defaultTool })
      .withExtraTools({ extraTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools: {
          ...tools,
          defaultTool: overrideTool, // override the default
          stepOnlyTool, // add step-specific tool
        },
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have all tools
    expect(agentStart.tools).toContain('defaultTool');
    expect(agentStart.tools).toContain('extraTool');
    expect(agentStart.tools).toContain('stepOnlyTool');
    expect(agentStart.tools).toContain('done');

    // Verify the override took effect by checking which tool description was passed to generateText
    const generateTextCall = agentMockGenerateText.mock.calls[0][0] as any;
    expect(generateTextCall.tools.defaultTool.description).toBe(
      'Override of default tool'
    );
  });

  it('withTools() after createBrain() replaces project defaults', async () => {
    setupDoneAgent();

    const projectDefault: any = {
      description: 'Project default tool',
      inputSchema: z.object({}),
      execute: async () => 'project',
    };

    const brainFn = createBrain({
      defaultTools: { projectDefault },
    });

    const myOnlyTool: any = {
      description: 'My only tool',
      inputSchema: z.object({ val: z.string() }),
      execute: async () => 'only',
    };

    // Calling withTools on a brain created by createBrain should replace projectDefault
    const testBrain = brainFn('tools-createbrain-replace')
      .withTools({ myOnlyTool })
      .brain('agent', ({ tools }) => ({
        prompt: 'Do something',
        tools,
        outputSchema: dummyOutputSchema,
        stateKey: dummyStateKey,
      }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: agentMockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const agentStart = events.find(
      (e) => e.type === BRAIN_EVENTS.AGENT_START
    ) as any;
    // Should have myOnlyTool and done, but NOT projectDefault
    expect(agentStart.tools).toContain('myOnlyTool');
    expect(agentStart.tools).toContain('done');
    expect(agentStart.tools).not.toContain('projectDefault');
  });
});

describe('IterateResult', () => {
  it('should provide .values, .filter().items, .length, and .map() during live execution', async () => {
    // Inner brain that produces a summary field
    const summarizeBrain = brain<{}, { summary: string }>('Summarizer').step(
      'Summarize',
      ({ state }) => ({ summary: 'test summary' })
    );

    const testBrain = brain('IterateResult Integration')
      .step('Init', () => ({
        items: [
          { name: 'alpha', important: true },
          { name: 'beta', important: false },
          { name: 'gamma', important: true },
        ],
      }))
      .map('Summarize', {
        run: summarizeBrain,
        over: ({ state }) => state.items,
        initialState: (item) => ({ summary: '' }),
        stateKey: 'results' as const,
      })
      .step('Use IterateResult API', ({ state }) => {
        const summaries = state.results.values.map((r) => r.summary);
        const importantNames = state.results
          .filter((item) => item.important)
          .items.map((i) => i.name);
        const labels = state.results.map(
          (item, r) => `${item.name}:${r.summary}`
        );

        return {
          ...state,
          summaries,
          importantNames,
          count: state.results.length,
          labels,
        };
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    const finalState = finalStateFromEvents(events);
    expect(finalState.summaries).toEqual([
      'test summary',
      'test summary',
      'test summary',
    ]);
    expect(finalState.importantNames).toEqual(['alpha', 'gamma']);
    expect(finalState.count).toBe(3);
    expect(finalState.labels).toEqual([
      'alpha:test summary',
      'beta:test summary',
      'gamma:test summary',
    ]);
  });
});

describe('IterateResult rehydration on resume', () => {
  it('should re-wrap plain arrays as IterateResult when resuming after a completed map step', async () => {
    const innerBrain = brain<{}, { doubled: number }>('Doubler').step(
      'Double',
      ({ state }) => ({ doubled: state.doubled * 2 })
    );

    // Brain: Init -> MapA -> MapB -> Merge
    // We simulate resuming at MapB (stepIndex: 2), meaning MapA already completed.
    // MapA's results are in state as a plain array (from JSON patch reconstruction).
    const outerBrain = brain('RehydrationTest')
      .step('Init', () => ({
        itemsA: [{ id: 'a1' }, { id: 'a2' }],
        itemsB: [{ id: 'b1' }],
      }))
      .map('MapA', {
        run: innerBrain,
        over: ({ state }) => state.itemsA,
        initialState: (item) => ({ doubled: 1 }),
        stateKey: 'resultsA' as const,
      })
      .map('MapB', {
        run: innerBrain,
        over: ({ state }) => state.itemsB,
        initialState: (item) => ({ doubled: 3 }),
        stateKey: 'resultsB' as const,
      })
      .step('Merge', ({ state }) => {
        // This uses IterateResult.map() — would break with Array.prototype.map
        const idsA = state.resultsA.map((item, result) => item.id);
        const idsB = state.resultsB.map((item, result) => item.id);
        return { ...state, mergedIds: [...idsA, ...idsB] };
      });

    // Resume at step 2 (MapB). State contains MapA's results as a PLAIN ARRAY
    // (simulating what happens when state is reconstructed from JSON patches).
    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      resume: {
        state: {
          itemsA: [{ id: 'a1' }, { id: 'a2' }],
          itemsB: [{ id: 'b1' }],
          // This is what IterateResult.toJSON() produces — a plain array of tuples.
          // After JSON patch reconstruction, it's just a regular array.
          resultsA: [
            [{ id: 'a1' }, { doubled: 2 }],
            [{ id: 'a2' }, { doubled: 2 }],
          ],
        },
        stepIndex: 2, // Skip Init and MapA, resume at MapB
      },
      brainRunId: 'test-rehydrate',
    })) {
      events.push(event);
    }

    // Verify no errors
    const errorEvents = events.filter((e) => e.type === BRAIN_EVENTS.ERROR);
    expect(errorEvents).toHaveLength(0);

    // The Merge step's patch should contain the expected mergedIds,
    // proving IterateResult.map() worked on the rehydrated resultsA.
    const mergeComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        'stepTitle' in e &&
        e.stepTitle === 'Merge'
    ) as any;
    expect(mergeComplete).toBeDefined();
    expect(mergeComplete.patch).toBeDefined();

    // Apply only the Merge step's patch to see what it produced
    const stateBeforeMerge = {
      itemsA: [{ id: 'a1' }, { id: 'a2' }],
      itemsB: [{ id: 'b1' }],
      resultsA: [
        [{ id: 'a1' }, { doubled: 2 }],
        [{ id: 'a2' }, { doubled: 2 }],
      ],
      resultsB: [[{ id: 'b1' }, { doubled: 6 }]],
    };
    const finalState = applyPatches(stateBeforeMerge, [
      mergeComplete.patch,
    ]) as any;
    expect(finalState.mergedIds).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('UI steps', () => {
  // Mock components for UI generation
  const mockComponents = {
    Form: {
      component: () => null,
      description: 'A form container',
    },
    Input: {
      component: () => null,
      description: 'A text input',
    },
  };

  // Mock pages service
  const mockPages = {
    create: jest.fn<any>().mockResolvedValue({
      slug: 'test-page',
      url: 'https://example.com/pages/test-page',
      brainRunId: 'test-run',
      persist: false,
      createdAt: new Date().toISOString(),
    }),
    get: jest.fn(),
    exists: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(() => {
    mockStreamText.mockClear();
    mockGenerateObject.mockClear();
    mockPages.create.mockClear();

    // Mock streamText to return a valid YAML template for generateUI
    mockStreamText.mockResolvedValue({
      toolCalls: [],
      text: `Form:\n  children:\n    - Input:\n        name: "field1"\n        label: "Field 1"`,
      usage: { totalTokens: 100 },
    });
  });

  it('should suspend at WEBHOOK when outputSchema is provided (initial run)', async () => {
    const testBrain = brain('UI Form Test')
      .withComponents(mockComponents)
      .step('Init', () => ({ userName: 'Alice' }))
      .ui('Collect Feedback', {
        template: ({ state }) => `Create a form for ${state.userName}`,
        outputSchema: z.object({ rating: z.number() }),
      });

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      pages: mockPages as any,
      env: { origin: 'https://example.com', secrets: {} },
    })) {
      events.push(event);
    }

    const eventTypes = events.map((e) => e.type);

    // Should emit WEBHOOK event
    const webhookIndex = eventTypes.indexOf(BRAIN_EVENTS.WEBHOOK);
    expect(webhookIndex).toBeGreaterThan(-1);

    // No STEP_COMPLETE for the UI step before WEBHOOK —
    // the step spans the suspend/resume boundary
    const stepCompletesBeforeWebhook = events
      .slice(0, webhookIndex)
      .filter((e) => e.type === BRAIN_EVENTS.STEP_COMPLETE);
    // Only the Init step should have completed before WEBHOOK
    expect(stepCompletesBeforeWebhook).toHaveLength(1);
    expect((stepCompletesBeforeWebhook[0] as any).stepTitle).toBe('Init');
  });

  it('should merge form response onto state when resumed', async () => {
    const feedbackSchema = z.object({
      rating: z.number(),
      comments: z.string(),
    });

    const testBrain = brain('UI Resume Test')
      .withComponents(mockComponents)
      .step('Init', () => ({ userName: 'Alice' }))
      .ui('Collect Feedback', {
        template: ({ state }) => `Create a form for ${state.userName}`,
        outputSchema: feedbackSchema,
      })
      .step('After UI', ({ state }) => ({
        ...state,
        processed: true,
      }));

    // Resume with webhook response — the UI step is at index 1
    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      pages: mockPages as any,
      env: { origin: 'https://example.com', secrets: {} },
      brainRunId: 'test-run',
      resume: {
        state: { userName: 'Alice' },
        stepIndex: 1, // UI step index
        webhookResponse: { rating: 5, comments: 'Great!' },
      },
    })) {
      events.push(event);
    }

    // Reconstruct state by applying STEP_COMPLETE patches to the resume state
    let finalState: any = { userName: 'Alice' };
    for (const event of events) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [(event as any).patch]);
      }
    }

    expect(finalState.rating).toBe(5);
    expect(finalState.comments).toBe('Great!');
    expect(finalState.processed).toBe(true);

    // The UI step should complete with a patch that includes the merge
    const uiStepComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        (e as any).stepTitle === 'Collect Feedback'
    );
    expect(uiStepComplete).toBeDefined();
    expect((uiStepComplete as any).patch.length).toBeGreaterThan(0);

    // Brain should complete
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should complete immediately for read-only UI (no outputSchema)', async () => {
    const testBrain = brain('Read-only UI Test')
      .withComponents(mockComponents)
      .step('Init', () => ({ data: 'hello' }))
      .ui('Dashboard', {
        template: ({ state }) => `Show dashboard for ${state.data}`,
      })
      .step('After', ({ state }) => ({ ...state, done: true }));

    const events: BrainEvent<any>[] = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
      pages: mockPages as any,
      env: { origin: 'https://example.com', secrets: {} },
    })) {
      events.push(event);
    }

    // Should complete without suspending
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(events.some((e) => e.type === BRAIN_EVENTS.WEBHOOK)).toBe(false);

    // Read-only UI step should emit pageContext on its STEP_COMPLETE
    const uiStepComplete = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        (e as any).stepTitle === 'Dashboard'
    ) as any;
    expect(uiStepComplete.pageContext).toBeDefined();
    expect(uiStepComplete.pageContext.url).toBe(
      'https://example.com/pages/test-page'
    );

    const finalState = finalStateFromEvents(events);
    expect(finalState.done).toBe(true);
  });
});
