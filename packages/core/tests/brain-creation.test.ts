import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import { brain } from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import { createWebhook } from '../src/index.js';
import {
  nextStep,
  mockGenerateObject,
  mockClient,
  mockResourceLoad,
  mockResources,
} from './brain-test-helpers.js';

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
      .prompt('Use default client', () => ({
        message: 'prompt1',
        outputSchema: z.object({ override: z.boolean() }),
      }))
      .prompt('Use override client', () => ({
        message: 'prompt2',
        outputSchema: z.object({ override: z.boolean() }),
        client: overrideClient,
      }));

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
      () => ({
        message: 'prompt1',
        outputSchema: z.object({ derived: z.boolean() }),
        client: overrideClient,
      })
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

  it('should use brain-level client for prompt steps', async () => {
    const brainLevelClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest
        .fn<ObjectGenerator['generateObject']>()
        .mockResolvedValue({ object: { result: 'from brain client' } }),
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    const testBrain = brain({
      title: 'Brain Level Client Test',
      client: brainLevelClient,
    }).prompt('Analyze', () => ({
      message: 'analyze this',
      outputSchema: z.object({ result: z.string() }),
    }));

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

    // Brain-level client was used, not the runner's default
    expect(brainLevelClient.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'analyze this' })
    );
    expect(mockClient.generateObject).not.toHaveBeenCalled();
    expect(finalState).toEqual({ result: 'from brain client' });
  });

  it('should let step-level client override brain-level client in prompt', async () => {
    const brainLevelClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest
        .fn<ObjectGenerator['generateObject']>()
        .mockResolvedValue({ object: { result: 'from brain' } }),
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    const stepLevelClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest
        .fn<ObjectGenerator['generateObject']>()
        .mockResolvedValue({ object: { result: 'from step' } }),
      streamText: jest.fn<ObjectGenerator['streamText']>(),
    };

    const testBrain = brain({
      title: 'Step Override Brain Client',
      client: brainLevelClient,
    }).prompt('Analyze', () => ({
      message: 'analyze this',
      outputSchema: z.object({ result: z.string() }),
      client: stepLevelClient,
    }));

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

    // Step-level wins over brain-level
    expect(stepLevelClient.generateObject).toHaveBeenCalled();
    expect(brainLevelClient.generateObject).not.toHaveBeenCalled();
    expect(mockClient.generateObject).not.toHaveBeenCalled();
    expect(finalState).toEqual({ result: 'from step' });
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
        async ({ resources }) => ({
          message: `Generate a summary for: ${await (
            resources.myFile as any
          ).loadText()}`,
          outputSchema: z.object({ summary: z.string() }),
        })
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
        .prompt('Analyze Data', ({ state }) => ({
          message: `Analyze this: ${state.existingData}`,
          outputSchema: z.object({ analysis: z.string() }),
        }));

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
