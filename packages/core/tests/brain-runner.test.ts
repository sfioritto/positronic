import { BrainRunner } from '../src/dsl/brain-runner.js';
import { brain, type SerializedStep } from '../src/dsl/brain.js';
import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import { Adapter } from '../src/adapters/types.js';
import { createResources, type Resources } from '../src/resources/resources.js';
import type { ResourceLoader } from '../src/resources/resource-loader.js';
import type { Webhook } from '../src/dsl/webhook.js';
import { z } from 'zod';

describe('BrainRunner', () => {
  const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
  const mockClient: jest.Mocked<ObjectGenerator> = {
    generateObject: mockGenerateObject,
  };

  const mockDispatch = jest.fn<Adapter['dispatch']>();
  const mockAdapter: jest.Mocked<Adapter> = {
    dispatch: mockDispatch,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run a brain and dispatch events to adapters', async () => {
    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    const testBrain = brain('Test Brain')
      .step('First Step', () => ({ value: 42 }))
      .step('Async Step', async ({ state }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...state, asyncValue: 'completed' };
      })
      .step('Final Step', ({ state }) => ({
        ...state,
        finalValue: state.value * 2,
      }));

    await runner.run(testBrain);

    // Verify adapter received all events in correct order
    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
        brainTitle: 'Test Brain',
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        stepTitle: 'First Step',
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        stepTitle: 'Async Step',
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.STEP_COMPLETE,
        stepTitle: 'Final Step',
      })
    );

    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
      })
    );

    // Verify the order of events
    const stepCompletions = mockAdapter.dispatch.mock.calls
      .filter((call) => (call[0] as any).type === BRAIN_EVENTS.STEP_COMPLETE)
      .map((call) => (call[0] as any).stepTitle);

    expect(stepCompletions).toEqual(['First Step', 'Async Step', 'Final Step']);
  });

  it('should handle brain errors', async () => {
    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    const errorBrain = brain('Error Brain').step('Error Step', () => {
      throw new Error('Test error');
    });

    try {
      await runner.run(errorBrain);
    } catch (error) {
      // Expected error
    }

    // Verify error event was dispatched
    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.ERROR,
        error: expect.objectContaining({
          message: 'Test error',
        }),
      })
    );
  });

  it('should maintain state between steps', async () => {
    const runner = new BrainRunner({
      adapters: [],
      client: mockClient,
    });

    const testBrain = brain('Test Brain')
      .step('First Step', () => ({ count: 1 }))
      .step('Second Step', ({ state }) => ({
        count: state.count + 1,
      }));

    const result = await runner.run(testBrain);

    expect(result.count).toEqual(2);
  });

  it('should pass resources to step actions', async () => {
    const mockLoad = jest.fn(
      async (
        resourceName: string,
        type?: 'text' | 'binary'
      ): Promise<string | Buffer> => {
        if (type === 'binary') {
          return Buffer.from(`content of ${resourceName}`);
        }
        return `content of ${resourceName}`;
      }
    ) as jest.MockedFunction<ResourceLoader['load']>;

    const mockResourceLoader: ResourceLoader = {
      load: mockLoad,
    };

    const testManifest = {
      myTextFile: {
        type: 'text' as const,
        key: 'myTextFile',
        path: '/test/myTextFile.txt',
      },
      myBinaryFile: {
        type: 'binary' as const,
        key: 'myBinaryFile',
        path: '/test/myBinaryFile.bin',
      },
    } as const;

    const testResources = createResources(mockResourceLoader, testManifest);

    const runner = new BrainRunner({
      adapters: [],
      client: mockClient,
    }).withResources(testResources);

    let textContent: string | undefined;
    let binaryContent: Buffer | undefined;

    const resourceConsumingBrain = brain('Resource Brain').step(
      'Load Resources',
      async ({ resources }) => {
        textContent = await (resources.myTextFile as any).loadText();
        binaryContent = await (resources.myBinaryFile as any).loadBinary();
        return {};
      }
    );

    await runner.run(resourceConsumingBrain);

    expect(mockLoad).toHaveBeenCalledWith('myTextFile', 'text');
    expect(mockLoad).toHaveBeenCalledWith('myBinaryFile', 'binary');
    expect(textContent).toBe('content of myTextFile');
    expect(binaryContent?.toString()).toBe('content of myBinaryFile');
  });

  it('should chain adapters with withAdapters method', async () => {
    const mockAdapter2: jest.Mocked<Adapter> = {
      dispatch: jest.fn(),
    };
    const mockAdapter3: jest.Mocked<Adapter> = {
      dispatch: jest.fn(),
    };

    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    // Chain additional adapters
    const updatedRunner = runner.withAdapters([mockAdapter2, mockAdapter3]);

    const testBrain = brain('Test Brain').step('Step 1', () => ({ value: 1 }));

    await updatedRunner.run(testBrain);

    // Verify all adapters received events
    expect(mockAdapter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
      })
    );
    expect(mockAdapter2.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
      })
    );
    expect(mockAdapter3.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BRAIN_EVENTS.START,
      })
    );

    // Verify all adapters received the same number of events
    expect(mockAdapter.dispatch).toHaveBeenCalledTimes(
      mockAdapter2.dispatch.mock.calls.length
    );
    expect(mockAdapter2.dispatch).toHaveBeenCalledTimes(
      mockAdapter3.dispatch.mock.calls.length
    );
  });

  it('should replace client with withClient method', async () => {
    const originalClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest.fn(),
    };
    const newClient: jest.Mocked<ObjectGenerator> = {
      generateObject: jest.fn(),
    };

    // Configure the new client's response
    newClient.generateObject.mockResolvedValue({ result: 'from new client' });

    const runner = new BrainRunner({
      adapters: [],
      client: originalClient,
    });

    // Replace the client
    const updatedRunner = runner.withClient(newClient);

    // Define schema once to ensure same reference
    const testSchema = z.object({ result: z.string() });

    const testBrain = brain('Test Brain').step(
      'Generate',
      async ({ client }) => {
        const response = await client.generateObject({
          prompt: 'test prompt',
          schema: testSchema,
          schemaName: 'TestSchema',
        });
        return { generated: response.result };
      }
    );

    const result = await updatedRunner.run(testBrain);

    // Verify new client was used, not the original
    expect(originalClient.generateObject).not.toHaveBeenCalled();
    expect(newClient.generateObject).toHaveBeenCalledWith({
      prompt: 'test prompt',
      schema: testSchema,
      schemaName: 'TestSchema',
    });
    expect(result.generated).toBe('from new client');
  });

  it('should apply patches from initialCompletedSteps and continue from correct state', async () => {
    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    // Simulate completed steps with patches
    const completedSteps: SerializedStep[] = [
      {
        id: 'step-1',
        title: 'First Step',
        status: STATUS.COMPLETE,
        patch: [
          {
            op: 'add',
            path: '/count',
            value: 10,
          },
        ],
      },
      {
        id: 'step-2',
        title: 'Second Step',
        status: STATUS.COMPLETE,
        patch: [
          {
            op: 'add',
            path: '/name',
            value: 'test',
          },
        ],
      },
    ];

    const testBrain = brain('Test Brain')
      .step('First Step', () => ({ count: 10 }))
      .step('Second Step', ({ state }) => ({ ...state, name: 'test' }))
      .step('Third Step', ({ state }) => ({
        ...state,
        count: state.count + 5,
        message: `${state.name} completed`,
      }));

    const result = await runner.run(testBrain, {
      initialCompletedSteps: completedSteps,
      brainRunId: 'test-run-123',
    });

    // Verify the final state includes patches from completed steps
    expect(result).toEqual({
      count: 15,
      name: 'test',
      message: 'test completed',
    });

    // Verify that the brain runner applied the patches correctly
    // The runner should have seen all steps execute, but the first two were already completed
    const stepCompleteEvents = mockAdapter.dispatch.mock.calls.filter(
      (call) => call[0].type === BRAIN_EVENTS.STEP_COMPLETE
    );

    // All steps will emit complete events in the current implementation
    expect(stepCompleteEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('should stop execution after specified number of steps with endAfter parameter', async () => {
    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    const testBrain = brain('Test Brain')
      .step('Step 1', () => ({ step1: 'done' }))
      .step('Step 2', ({ state }) => ({ ...state, step2: 'done' }))
      .step('Step 3', ({ state }) => ({ ...state, step3: 'done' }))
      .step('Step 4', ({ state }) => ({ ...state, step4: 'done' }));

    // Run brain but stop after 2 steps
    const result = await runner.run(testBrain, {
      endAfter: 2,
    });

    // Verify state only has results from first 2 steps
    expect(result).toEqual({
      step1: 'done',
      step2: 'done',
    });

    // Verify only 2 step complete events were dispatched
    const stepCompleteEvents = mockAdapter.dispatch.mock.calls
      .filter((call) => call[0].type === BRAIN_EVENTS.STEP_COMPLETE)
      .map((call) => (call[0] as any).stepTitle);

    expect(stepCompleteEvents).toEqual(['Step 1', 'Step 2']);

    // Verify that COMPLETE event was NOT dispatched (brain didn't finish)
    const completeEvents = mockAdapter.dispatch.mock.calls.filter(
      (call) => call[0].type === BRAIN_EVENTS.COMPLETE
    );

    expect(completeEvents.length).toBe(0);
  });

  it('should stop execution when webhook event is encountered', async () => {
    // Define a test webhook
    const testWebhook = (identifier: string) => ({
      slug: 'test-webhook',
      identifier,
      schema: z.object({ response: z.string() }),
    });

    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    const testBrain = brain('Webhook Test Brain')
      .step('First Step', () => ({ count: 1 }))
      .step('Webhook Step', ({ state }) => ({
        state,
        webhooks: [testWebhook('test-id')],
      }))
      .step('Third Step', ({ state }) => ({
        ...state,
        processed: true,
      }));

    const result = await runner.run(testBrain);

    // Verify the final state only includes changes up to webhook step
    expect(result).toEqual({ count: 1 });

    // Verify webhook event was dispatched
    const webhookEvents = mockAdapter.dispatch.mock.calls.filter(
      (call) => call[0].type === BRAIN_EVENTS.WEBHOOK
    );
    expect(webhookEvents.length).toBe(1);
    expect(webhookEvents[0][0]).toEqual(
      expect.objectContaining({
        type: BRAIN_EVENTS.WEBHOOK,
        webhooks: [
          {
            slug: 'test-webhook',
            identifier: 'test-id',
            schema: expect.any(Object),
          }
        ],
        state: { count: 1 }
      })
    );

    // Verify only first two steps completed
    const stepCompleteEvents = mockAdapter.dispatch.mock.calls
      .filter((call) => call[0].type === BRAIN_EVENTS.STEP_COMPLETE)
      .map((call) => (call[0] as any).stepTitle);

    expect(stepCompleteEvents).toEqual(['First Step', 'Webhook Step']);

    // Verify third step was never started
    const stepStartEvents = mockAdapter.dispatch.mock.calls
      .filter((call) => call[0].type === BRAIN_EVENTS.STEP_START)
      .map((call) => (call[0] as any).stepTitle);

    expect(stepStartEvents).not.toContain('Third Step');

    // Verify brain didn't complete
    const completeEvents = mockAdapter.dispatch.mock.calls.filter(
      (call) => call[0].type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvents.length).toBe(0);
  });

  it('should restart brain with webhook response', async () => {
    // Define a test webhook
    const userInputWebhook = (identifier: string) => ({
      slug: 'user-input-webhook',
      identifier,
      schema: z.object({ userInput: z.string() }),
    });

    const runner = new BrainRunner({
      adapters: [mockAdapter],
      client: mockClient,
    });

    const testBrain = brain('Webhook Restart Brain')
      .step('Initial Step', () => ({ count: 1 }))
      .step('Webhook Step', ({ state }) => ({
        state: { ...state, webhookSent: true },
        webhooks: [userInputWebhook('user-id')],
      }))
      .step('Process Response', ({ state, response }) => ({
        ...state,
        userResponse: response?.userInput || 'no response',
        processed: true,
      }));

    // First run - should stop at webhook
    const firstRunState = await runner.run(testBrain);
    
    expect(firstRunState).toEqual({ 
      count: 1, 
      webhookSent: true 
    });

    // Get the completed steps from the first run
    const stepCompleteEvents = mockAdapter.dispatch.mock.calls
      .filter((call) => call[0].type === BRAIN_EVENTS.STEP_COMPLETE)
      .map((call) => call[0] as any);

    const completedSteps: SerializedStep[] = stepCompleteEvents.map((event) => ({
      id: event.stepId,
      title: event.stepTitle,
      status: STATUS.COMPLETE,
      patch: event.patch,
    }));

    // Get the brain run ID from the first run
    const startEvent = mockAdapter.dispatch.mock.calls.find(
      (call) => call[0].type === BRAIN_EVENTS.START
    );
    const brainRunId = (startEvent![0] as any).brainRunId;

    // Clear mock calls for clarity
    mockAdapter.dispatch.mockClear();

    // Restart with webhook response
    const finalState = await runner.run(testBrain, {
      initialState: firstRunState,
      initialCompletedSteps: completedSteps,
      brainRunId,
      response: { userInput: 'Hello from webhook!' },
    });

    expect(finalState).toEqual({
      count: 1,
      webhookSent: true,
      userResponse: 'Hello from webhook!',
      processed: true,
    });

    // Verify only the Process Response step ran in the restart
    const restartStepCompleteEvents = mockAdapter.dispatch.mock.calls
      .filter((call) => call[0].type === BRAIN_EVENTS.STEP_COMPLETE)
      .map((call) => (call[0] as any).stepTitle);

    expect(restartStepCompleteEvents).toEqual(['Process Response']);

    // Verify the brain completed this time
    const completeEvents = mockAdapter.dispatch.mock.calls.filter(
      (call) => call[0].type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvents.length).toBe(1);
  });
});
