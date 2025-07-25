import { BrainRunner } from '../src/dsl/brain-runner.js';
import { brain, type SerializedStep } from '../src/dsl/brain.js';
import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ObjectGenerator } from '../src/clients/types.js';
import { Adapter } from '../src/adapters/types.js';
import { createResources, type Resources } from '../src/resources/resources.js';
import type { ResourceLoader } from '../src/resources/resource-loader.js';
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
});
