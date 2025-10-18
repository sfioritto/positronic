import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches, type JsonPatch } from '../src/dsl/json-patch.js';
import { State } from '../src/dsl/types.js';
import {
  brain,
  type BrainEvent,
  type BrainErrorEvent,
  type SerializedStep,
  type SerializedStepStatus,
} from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import { createResources } from '../src/resources/resources.js';
import type { ResourceLoader } from '../src/resources/resource-loader.js';
import { createWebhook } from '../src/index.js';

// Helper function to get the next value from an AsyncIterator
const nextStep = async <T>(brainRun: AsyncIterator<T>): Promise<T> => {
  const result = await brainRun.next();
  if (result.done) throw new Error('Iterator is done');
  return result.value;
};

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
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
};

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
        identifier: 'test-id',
        response: { userResponse: 'test' }
      })
    );

    const testBrain = brain('webhook test brain')
      .step('First step', () => {
        return { count: 1 };
      })
      .step('Webhook step', ({ state }) => ({
        state,
        waitFor: [testWebhook('test-id')],
      }))
      .step('Third step', ({ state }) => ({
        ...state,
        processed: true,
      }));

    const events = [];
    for await (const event of testBrain.run({ client: mockClient })) {
      events.push(event);
    }

    // Find the webhook event
    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
    expect(webhookEvent).toBeDefined();
    expect(webhookEvent).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.WEBHOOK,
        waitFor: [
          {
            slug: 'test-webhook',
            identifier: 'test-id',
            schema: expect.any(Object),
          }
        ],
        state: { count: 1 },
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
        .mockResolvedValue({ override: true }),
    };

    // Make sure that for the default prompt the default client returns a known value.
    mockClient.generateObject.mockResolvedValueOnce({ override: false });

    const testBrain = brain('Client Override Test')
      .prompt('Use default client', {
        template: () => 'prompt1',
        outputSchema: {
          schema: z.object({ override: z.boolean() }),
          name: 'overrideResponse',
        },
      })
      .prompt('Use override client', {
        template: () => 'prompt2',
        outputSchema: {
          schema: z.object({ override: z.boolean() }),
          name: 'overrideResponse',
        },
        client: overrideClient,
      });

    // Run the brain and capture all events
    const events = [];
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
    })) {
      events.push(event);
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Final state should include both responses
    expect(finalState).toEqual({
      overrideResponse: { override: true },
    });

    // Verify that each client was used correctly based on the supplied prompt configuration.
    expect(mockClient.generateObject).toHaveBeenCalledWith({
      schema: expect.any(z.ZodObject),
      schemaName: 'overrideResponse',
      prompt: 'prompt1',
    });
    expect(overrideClient.generateObject).toHaveBeenCalledWith({
      schema: expect.any(z.ZodObject),
      schemaName: 'overrideResponse',
      prompt: 'prompt2',
    });

    // Verify that the state was updated correctly with values from both clients.
  });

  it('should use the provided brainRunId for the initial run if supplied', async () => {
    const testBrain = brain('Brain with Provided ID');
    const providedId = 'my-custom-run-id-123';

    const brainRun = testBrain.run({
      client: mockClient,
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
        resources: mockResources,
      });
      // Iterate through to completion
      for await (const _ of run) {
      }

      expect(mockResourceLoad).toHaveBeenCalledWith('myFile', 'text');
      expect(loadedText).toBe('mock myFile text content');
    });

    it('should make resources available in a prompt action and reducer', async () => {
      mockGenerateObject.mockResolvedValue({ summary: 'Generated summary' });
      let promptTemplateString: string | undefined;
      let reduceContent: string | undefined;

      const testBrain = brain<
        {},
        {
          promptResult?: any;
          reducedResult?: string;
          fileContentForPrompt?: string;
        }
      >('Resource Prompt Test')
        .step('Load File For Prompt', async ({ resources }) => {
          const fileContent = await (resources.myFile as any).loadText();
          return { fileContentForPrompt: fileContent };
        })
        .prompt(
          'Summarize File',
          {
            template: (state) => {
              return 'Summarize: ' + state.fileContentForPrompt;
            },
            outputSchema: {
              schema: z.object({ summary: z.string() }),
              name: 'promptResult' as const,
            },
          },
          async ({ state, response, resources }) => {
            reduceContent = await (
              (resources.nested as any).anotherFile as any
            ).loadText();
            return {
              ...state,
              reducedResult: response.summary + ' based on ' + reduceContent,
            };
          }
        );

      const run = testBrain.run({
        client: mockClient,
        resources: mockResources,
      });
      let finalState: any = {};
      const allPatches: JsonPatch[] = [];
      const initialStateForReconstruction = {};

      for await (const event of run) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE && event.patch) {
          allPatches.push(event.patch);
        }
      }
      finalState = applyPatches(initialStateForReconstruction, allPatches);

      expect(mockResourceLoad).toHaveBeenCalledWith('myFile', 'text');
      expect(mockResourceLoad).toHaveBeenCalledWith('anotherFile', 'text');
      expect(reduceContent).toBe('mock anotherFile text content');
      expect(finalState.reducedResult).toBe(
        'Generated summary based on mock anotherFile text content'
      );
    });

    it('should pass resources to prompt template function', async () => {
      const testBrain = brain('Resource Prompt Template Test').prompt(
        'Generate Summary',
        {
          template: async (state, resources) => {
            const templateContent = await (resources.myFile as any).loadText();
            return `Generate a summary for: ${templateContent}`;
          },
          outputSchema: {
            schema: z.object({ summary: z.string() }),
            name: 'promptResult' as const,
          },
        }
      );

      mockGenerateObject.mockResolvedValue({ summary: 'Test summary' });

      const run = testBrain.run({
        client: mockClient,
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

      // Verify final state
      expect(finalState).toEqual({
        promptResult: { summary: 'Test summary' },
      });
    });

    it('templates can use state', async () => {
      const testBrain = brain('State Template Test')
        .step('Set Data', () => ({ existingData: 'legacy data' }))
        .prompt('Analyze Data', {
          template: (state) => {
            return `Analyze this: ${state.existingData}`;
          },
          outputSchema: {
            schema: z.object({ analysis: z.string() }),
            name: 'promptResult' as const,
          },
        });

      mockGenerateObject.mockResolvedValue({
        analysis: 'Analysis result',
      });

      const run = testBrain.run({
        client: mockClient,
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

      // Verify final state
      expect(finalState).toEqual({
        existingData: 'legacy data',
        promptResult: { analysis: 'Analysis result' },
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
        innerBrain,
        ({ state, brainState }) => ({ ...state, ...brainState })
      );

      const run = outerBrain.run({
        client: mockClient,
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
      .brain(
        'Run inner brain',
        innerBrain,
        ({ state, brainState }) => ({
          ...state,
          step: 'second',
          innerResult: brainState.value,
        }),
        () => ({ value: 5 })
      );

    const events: BrainEvent<any>[] = [];
    let error: Error | undefined;
    let mainBrainId: string | undefined;

    try {
      for await (const event of outerBrain.run({
        client: mockClient,
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

    // Find inner and outer error events by brainRunId
    const innerErrorEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.ERROR && e.brainRunId !== mainBrainId
    ) as BrainErrorEvent<any>;

    const outerErrorEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.ERROR && e.brainRunId === mainBrainId
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
  };

  it('should resume brain from the correct step when given initialCompletedSteps', async () => {
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
    let initialCompletedSteps: SerializedStep[] = []; // Use the correct type
    const initialState = { initialValue: true };
    let firstStepState: State = initialState;
    let allStepsInfo: SerializedStepStatus[] = []; // Explicit type annotation needed

    // Run brain until we get the first step completed
    for await (const event of threeStepBrain.run({
      client: mockClient as ObjectGenerator,
      initialState,
    })) {
      // Capture the full step list from the first status event
      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        allStepsInfo = event.steps; // Direct assignment, type is SerializedStepStatus[]
      }

      if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        event.stepTitle === 'Step 1'
      ) {
        firstStepState = applyPatches(firstStepState, [event.patch]);
        // Construct initialCompletedSteps with the full data for completed steps
        initialCompletedSteps = allStepsInfo.map((stepInfo, index) => {
          if (index === 0) {
            // If it's Step 1
            return { ...stepInfo, status: STATUS.COMPLETE, patch: event.patch };
          } else {
            return { ...stepInfo, status: STATUS.PENDING, patch: undefined };
          }
        });
        break; // Stop after first step
      }
    }

    // Clear executed steps array
    executedSteps.length = 0;

    // Resume brain with first step completed
    let resumedState: State | undefined;
    if (!initialCompletedSteps)
      throw new Error('Expected initialCompletedSteps');

    for await (const event of threeStepBrain.run({
      client: mockClient as ObjectGenerator,
      initialState,
      initialCompletedSteps,
      brainRunId: 'test-run-id',
    })) {
      if (event.type === BRAIN_EVENTS.RESTART) {
        resumedState = event.initialState;
      } else if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        resumedState = applyPatches(resumedState!, [event.patch]);
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
      .brain(
        'Run inner brain',
        innerBrain,
        ({ state, brainState }) => ({
          ...state,
          innerResult: brainState.value,
        }),
        () => ({ value: 5 })
      );

    const events: BrainEvent<any>[] = [];
    for await (const event of outerBrain.run({
      client: mockClient,
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

    // Verify states are passed correctly
    let innerState: State = { value: 5 }; // Match the initial state from the brain
    let outerState = {};

    for (const event of events) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        if (event.stepTitle === 'Double value') {
          innerState = applyPatches(innerState, [event.patch]);
        } else {
          outerState = applyPatches(outerState, [event.patch]);
        }
      }
    }

    // Verify final states
    expect(innerState).toEqual({
      inner: true,
      value: 10,
    });

    expect(outerState).toEqual({
      prefix: 'test-',
      innerResult: 10,
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
      .brain(
        'Run inner brain',
        innerBrain,
        ({ state, brainState }) => ({
          ...state,
          step: 'second',
          innerResult: brainState.value,
        }),
        () => ({ value: 5 })
      );

    const events: BrainEvent<any>[] = [];
    let error: Error | undefined;
    let mainBrainId: string | undefined;

    try {
      for await (const event of outerBrain.run({
        client: mockClient,
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

    // Find inner and outer error events by brainRunId
    const innerErrorEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.ERROR && e.brainRunId !== mainBrainId
    ) as BrainErrorEvent<any>;

    const outerErrorEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.ERROR && e.brainRunId === mainBrainId
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
      .brain(
        'Run inner brain',
        innerBrain,
        ({ state, brainState }) => ({
          ...state,
          result: brainState.value,
        }),
        (state) => ({ value: state.value })
      );

    // Run brain and collect step status events
    let finalStepStatus;
    for await (const event of outerBrain.run({
      client: mockClient,
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

    // Check step status (running)
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
      .brain(
        'Nested brain',
        innerBrain,
        ({ state, brainState }) => ({
          ...state,
          processedValue: brainState.processedValue,
          totalFeatures: brainState.featureCount,
        }),
        () => ({
          processedValue: 0,
          featureCount: 0,
        })
      )
      .step('Final step', ({ state }) => ({
        ...state,
        completed: true,
      }));

    // Type test setup
    type ExpectedState = {
      initialFeatures: string[];
      value: number;
      processedValue: number;
      totalFeatures: number;
      completed: true;
    };

    type ActualState = Parameters<
      Parameters<(typeof complexBrain)['step']>[1]
    >[0]['state'];

    type TypeTest = AssertEquals<ActualState, ExpectedState>;
    const _typeAssert: TypeTest = true;

    // Collect all events
    const events = [];
    let finalStepStatus,
      finalState = {};
    let mainBrainId: string | undefined;

    for await (const event of complexBrain.run({
      client: mockClient,
      options: { features: ['fast', 'secure'] },
    })) {
      events.push(event);

      // Capture the main brain's ID from its start event
      if (event.type === BRAIN_EVENTS.START && !mainBrainId) {
        mainBrainId = event.brainRunId;
      }

      if (event.type === BRAIN_EVENTS.STEP_STATUS) {
        finalStepStatus = event;
      } else if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        event.brainRunId === mainBrainId // Only process events from main brain
      ) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

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

    // Verify inner brain events are included
    const innerStartEvent = events.find(
      (e) =>
        e.type === BRAIN_EVENTS.START &&
        'brainRunId' in e &&
        e.brainRunId !== mainBrainId
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
      totalFeatures: 2,
      completed: true,
    });
  });

  it('should correctly infer brain reducer state types', async () => {
    // Create an inner brain with a specific state shape
    const innerBrain = brain('Inner State Test').step('Inner step', () => ({
      innerValue: 42,
      metadata: { processed: true },
    }));

    // Create outer brain to test reducer type inference
    const outerBrain = brain('Outer State Test')
      .step('First step', () => ({
        outerValue: 100,
        status: 'ready',
      }))
      .brain(
        'Nested brain',
        innerBrain,
        ({ state, brainState }) => {
          // Type assertion for outer state
          type ExpectedOuterState = {
            outerValue: number;
            status: string;
          };
          type ActualOuterState = typeof state;
          type OuterStateTest = AssertEquals<
            ActualOuterState,
            ExpectedOuterState
          >;
          const _outerAssert: OuterStateTest = true;

          // Type assertion for inner brain state
          type ExpectedInnerState = {
            innerValue: number;
            metadata: { processed: true };
          };
          type ActualInnerState = typeof brainState;
          type InnerStateTest = AssertEquals<
            ActualInnerState,
            ExpectedInnerState
          >;
          const _innerAssert: InnerStateTest = true;

          return {
            ...state,
            innerResult: brainState.innerValue,
            processed: brainState.metadata.processed,
          };
        },
        () => ({} as { innerValue: number; metadata: { processed: boolean } })
      );

    // Run the brain to verify runtime behavior
    let finalState = {};
    let mainBrainId: string | undefined;

    for await (const event of outerBrain.run({
      client: mockClient,
    })) {
      if (event.type === BRAIN_EVENTS.START && !mainBrainId) {
        mainBrainId = event.brainRunId;
      }
      if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        event.brainRunId === mainBrainId
      ) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    expect(finalState).toEqual({
      outerValue: 100,
      status: 'ready',
      innerResult: 42,
      processed: true,
    });
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
    let finalState = {};
    let mainBrainId: string | undefined;

    for await (const event of testBrain.run({
      client: mockClient,
    })) {
      if (event.type === BRAIN_EVENTS.START && !mainBrainId) {
        mainBrainId = event.brainRunId;
      }
      if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        event.brainRunId === mainBrainId
      ) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

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
        outputSchema: {
          schema: z.object({ name: z.string(), age: z.number() }),
          name: 'userInfo' as const, // Must be const or type inference breaks
        },
      })
      .step('Use response', ({ state }) => {
        // Type assertion to verify state includes userInfo
        type ExpectedState = {
          userInfo: {
            name: string;
            age: number;
          };
        };
        type ActualState = typeof state;
        type StateTest = AssertEquals<ActualState, ExpectedState>;
        const _stateAssert: StateTest = true;

        return {
          ...state,
          greeting: `Hello ${state.userInfo.name}, you are ${state.userInfo.age} years old`,
        };
      });

    // Mock the client response
    mockClient.generateObject.mockResolvedValueOnce({
      name: 'Test User',
      age: 30,
    });

    // Run brain and collect final state
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the brain executed correctly
    expect(finalState).toEqual({
      userInfo: {
        name: 'Test User',
        age: 30,
      },
      greeting: 'Hello Test User, you are 30 years old',
    });
  });

  it('should correctly handle prompt reduce function', async () => {
    const testBrain = brain('Prompt Reduce Test').prompt(
      'Get numbers',
      {
        template: () => 'Give me some numbers',
        outputSchema: {
          schema: z.object({ numbers: z.array(z.number()) }),
          name: 'numbersResponse' as const,
        },
      },
      ({ state, response, options }) => ({
        ...state,
        numbersResponse: response, // Include the response explicitly
        sum: response.numbers.reduce((a, b) => a + b, 0),
        count: response.numbers.length,
      })
    );

    // Mock the client response
    mockClient.generateObject.mockResolvedValueOnce({
      numbers: [1, 2, 3, 4, 5],
    });

    // Run brain and collect final state
    let finalState = {};
    for await (const event of testBrain.run({
      client: mockClient,
    })) {
      if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
        finalState = applyPatches(finalState, [event.patch]);
      }
    }

    // Verify the brain executed correctly with reduced state
    expect(finalState).toEqual({
      numbersResponse: {
        numbers: [1, 2, 3, 4, 5],
      },
      sum: 15,
      count: 5,
    });

    // Verify type inference works correctly
    type ExpectedState = {
      numbersResponse: {
        numbers: number[];
      };
      sum: number;
      count: number;
    };

    type ActualState = Parameters<
      Parameters<(typeof testBrain)['step']>[1]
    >[0]['state'];

    type TypeTest = AssertEquals<ActualState, ExpectedState>;
    const _typeAssert: TypeTest = true;
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
      .brain('Run inner brain', innerBrain, ({ brainState }) => ({
        result: brainState,
      }))
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
});
