import { BrainRunner } from './brain-runner.js';
import { brain } from './workflow.js';
import { BRAIN_EVENTS, STATUS } from './constants.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ObjectGenerator } from '../clients/types.js';
import { Adapter } from '../adapters/types.js';
import { createResources, type Resources } from '../resources/resources.js';
import type { ResourceLoader } from '../resources/resource-loader.js';

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
        workflowTitle: 'Test Brain',
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
});
