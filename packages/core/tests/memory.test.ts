import { jest } from '@jest/globals';
import { createMemory } from '../src/memory/create-memory.js';
import type {
  MemoryProvider,
  MemoryEntry,
  MemoryMessage,
} from '../src/memory/types.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import { definePlugin } from '../src/plugins/define-plugin.js';

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

describe('createMemory()', () => {
  it('should bind agentId and userId to search calls', async () => {
    const mockProvider = createMockProvider();
    const testMemories: MemoryEntry[] = [
      { id: '1', content: 'Test memory 1', score: 0.9 },
      { id: '2', content: 'Test memory 2', score: 0.8 },
    ];
    mockProvider.search.mockResolvedValue(testMemories);

    const memory = createMemory(mockProvider, 'my-brain', 'user-123');
    const result = await memory.search('test query');

    expect(mockProvider.search).toHaveBeenCalledWith(
      'test query',
      { agentId: 'my-brain', userId: 'user-123' },
      { limit: undefined }
    );
    expect(result).toEqual(testMemories);
  });

  it('should pass limit to search calls', async () => {
    const mockProvider = createMockProvider();
    const memory = createMemory(mockProvider, 'my-brain', 'user-123');

    await memory.search('test query', { limit: 5 });

    expect(mockProvider.search).toHaveBeenCalledWith(
      'test query',
      { agentId: 'my-brain', userId: 'user-123' },
      { limit: 5 }
    );
  });

  it('should bind agentId and userId to add calls', async () => {
    const mockProvider = createMockProvider();
    const memory = createMemory(mockProvider, 'my-brain', 'user-123');

    const messages: MemoryMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    await memory.add(messages);

    expect(mockProvider.add).toHaveBeenCalledWith(
      messages,
      { agentId: 'my-brain', userId: 'user-123' },
      { metadata: undefined }
    );
  });

  it('should pass metadata to add calls', async () => {
    const mockProvider = createMockProvider();
    const memory = createMemory(mockProvider, 'my-brain', 'user-123');

    const messages: MemoryMessage[] = [
      { role: 'assistant', content: 'User prefers dark mode' },
    ];

    await memory.add(messages, {
      metadata: { source: 'preference' },
    });

    expect(mockProvider.add).toHaveBeenCalledWith(
      messages,
      { agentId: 'my-brain', userId: 'user-123' },
      { metadata: { source: 'preference' } }
    );
  });
});

describe('memory via plugin system', () => {
  it('should inject memory into step context via withPlugin', async () => {
    const mockProvider = createMockProvider();
    const mockClient = createMockClient();
    const testMemories: MemoryEntry[] = [
      { id: '1', content: 'User likes TypeScript', score: 0.95 },
    ];
    mockProvider.search.mockResolvedValue(testMemories);

    const memoryPlugin = definePlugin({
      name: 'memory',
      create: ({ brainTitle, currentUser }) => {
        const memory = createMemory(mockProvider, brainTitle, currentUser.name);
        return {
          search: memory.search,
          add: memory.add,
        };
      },
    });

    let receivedMemory: any;

    const testBrain = brain('test-brain')
      .withPlugin(memoryPlugin)
      .step('Search Step', async ({ memory }) => {
        receivedMemory = memory;
        const memories = await memory.search('user preferences');
        return { preferences: memories };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
      })
    );

    expect(receivedMemory).toBeDefined();
    expect(receivedMemory.search).toBeDefined();
    expect(receivedMemory.add).toBeDefined();
    expect(mockProvider.search).toHaveBeenCalledWith(
      'user preferences',
      { agentId: 'test-brain', userId: 'test-user' },
      { limit: undefined }
    );
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });
});
