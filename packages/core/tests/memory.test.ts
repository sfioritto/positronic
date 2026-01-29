import { jest } from '@jest/globals';
import { createScopedMemory } from '../src/memory/scoped-memory.js';
import type { MemoryProvider, Memory, MemoryMessage } from '../src/memory/types.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import type { ObjectGenerator } from '../src/clients/types.js';

// Helper function to collect all events from a brain run
const collectEvents = async <T>(
  iterator: AsyncIterableIterator<T>
): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
};

// Mock memory provider for testing
const createMockProvider = (): jest.Mocked<MemoryProvider> => ({
  search: jest.fn<MemoryProvider['search']>().mockResolvedValue([]),
  add: jest.fn<MemoryProvider['add']>().mockResolvedValue(undefined),
});

// Mock ObjectGenerator for testing
const createMockClient = (): jest.Mocked<ObjectGenerator> => ({
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
});

describe('createScopedMemory', () => {
  it('should bind agentId to search calls', async () => {
    const mockProvider = createMockProvider();
    const testMemories: Memory[] = [
      { id: '1', content: 'Test memory 1', score: 0.9 },
      { id: '2', content: 'Test memory 2', score: 0.8 },
    ];
    mockProvider.search.mockResolvedValue(testMemories);

    const scopedMemory = createScopedMemory(mockProvider, 'my-brain');
    const result = await scopedMemory.search('test query');

    expect(mockProvider.search).toHaveBeenCalledWith(
      'test query',
      { agentId: 'my-brain', userId: undefined },
      { limit: undefined }
    );
    expect(result).toEqual(testMemories);
  });

  it('should pass userId and limit to search calls', async () => {
    const mockProvider = createMockProvider();
    const scopedMemory = createScopedMemory(mockProvider, 'my-brain');

    await scopedMemory.search('test query', { userId: 'user-123', limit: 5 });

    expect(mockProvider.search).toHaveBeenCalledWith(
      'test query',
      { agentId: 'my-brain', userId: 'user-123' },
      { limit: 5 }
    );
  });

  it('should bind agentId to add calls', async () => {
    const mockProvider = createMockProvider();
    const scopedMemory = createScopedMemory(mockProvider, 'my-brain');

    const messages: MemoryMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    await scopedMemory.add(messages);

    expect(mockProvider.add).toHaveBeenCalledWith(
      messages,
      { agentId: 'my-brain', userId: undefined },
      { metadata: undefined }
    );
  });

  it('should pass userId and metadata to add calls', async () => {
    const mockProvider = createMockProvider();
    const scopedMemory = createScopedMemory(mockProvider, 'my-brain');

    const messages: MemoryMessage[] = [
      { role: 'assistant', content: 'User prefers dark mode' },
    ];

    await scopedMemory.add(messages, {
      userId: 'user-123',
      metadata: { source: 'preference' },
    });

    expect(mockProvider.add).toHaveBeenCalledWith(
      messages,
      { agentId: 'my-brain', userId: 'user-123' },
      { metadata: { source: 'preference' } }
    );
  });
});

describe('Brain.withMemory', () => {
  it('should inject memory into step context', async () => {
    const mockProvider = createMockProvider();
    const mockClient = createMockClient();

    let receivedMemory: typeof mockProvider | undefined;

    const testBrain = brain('test-brain')
      .withMemory(mockProvider)
      .step('Test Step', ({ memory }) => {
        receivedMemory = memory as typeof mockProvider;
        return { done: true };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(receivedMemory).toBeDefined();
  });

  it('should allow calling memory.search in step', async () => {
    const mockProvider = createMockProvider();
    const mockClient = createMockClient();
    const testMemories: Memory[] = [
      { id: '1', content: 'User likes TypeScript', score: 0.95 },
    ];
    mockProvider.search.mockResolvedValue(testMemories);

    const testBrain = brain('test-brain')
      .withMemory(mockProvider)
      .step('Search Step', async ({ memory }) => {
        const memories = await memory!.search('user preferences');
        return { preferences: memories };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
      })
    );

    expect(mockProvider.search).toHaveBeenCalledWith(
      'user preferences',
      { agentId: 'test-brain', userId: undefined },
      { limit: undefined }
    );
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });

  it('should allow calling memory.add in step', async () => {
    const mockProvider = createMockProvider();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain')
      .withMemory(mockProvider)
      .step('Add Step', async ({ memory }) => {
        await memory!.add([
          { role: 'assistant', content: 'User prefers dark mode' },
        ]);
        return { saved: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
      })
    );

    expect(mockProvider.add).toHaveBeenCalledWith(
      [{ role: 'assistant', content: 'User prefers dark mode' }],
      { agentId: 'test-brain', userId: undefined },
      { metadata: undefined }
    );
  });

  it('should preserve memory through step chain', async () => {
    const mockProvider = createMockProvider();
    const mockClient = createMockClient();
    mockProvider.search.mockResolvedValue([]);

    let step1Memory: any;
    let step2Memory: any;

    const testBrain = brain('test-brain')
      .withMemory(mockProvider)
      .step('Step 1', ({ memory }) => {
        step1Memory = memory;
        return { step: 1 };
      })
      .step('Step 2', ({ memory }) => {
        step2Memory = memory;
        return { step: 2 };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
      })
    );

    expect(step1Memory).toBeDefined();
    expect(step2Memory).toBeDefined();
    // Both steps should have the same scoped memory
    expect(step1Memory).toBe(step2Memory);
  });

  it('should work with withServices', async () => {
    const mockProvider = createMockProvider();
    const mockClient = createMockClient();

    interface TestServices {
      logger: { log: (msg: string) => void };
    }

    const mockLogger = { log: jest.fn() };
    let receivedMemory: any;
    let receivedLogger: any;

    const testBrain = brain('test-brain')
      .withMemory(mockProvider)
      .withServices<TestServices>({ logger: mockLogger })
      .step('Combined Step', ({ memory, logger }) => {
        receivedMemory = memory;
        receivedLogger = logger;
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
      })
    );

    expect(receivedMemory).toBeDefined();
    expect(receivedLogger).toBe(mockLogger);
  });

  it('should handle undefined memory gracefully when not configured', async () => {
    const mockClient = createMockClient();

    let receivedMemory: any = 'not-undefined';

    const testBrain = brain('test-brain').step('No Memory Step', ({ memory }) => {
      receivedMemory = memory;
      return { done: true };
    });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        resources: {} as any,
      })
    );

    expect(receivedMemory).toBeUndefined();
  });
});
