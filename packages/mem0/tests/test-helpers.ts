import type {
  Memory,
  MemoryProvider,
  MemoryScope,
  MemoryMessage,
  ObjectGenerator,
} from '@positronic/core';
import { jest } from '@jest/globals';

/**
 * A mock memory provider that tracks calls for testing.
 * Implements the MemoryProvider interface at the boundary rather than mocking
 * internal details like fetch.
 */
export interface MockMemoryProvider extends MemoryProvider {
  /** Get all calls to the add method */
  getAddCalls(): Array<{
    messages: MemoryMessage[];
    scope: MemoryScope;
    options?: { metadata?: Record<string, unknown> };
  }>;
  /** Get all calls to the search method */
  getSearchCalls(): Array<{
    query: string;
    scope: MemoryScope;
    options?: { limit?: number };
  }>;
  /** Pre-seed memories that will be returned from search */
  seedMemories(memories: Memory[]): void;
  /** Reset all tracked calls and seeded memories */
  reset(): void;
}

/**
 * Creates a mock MemoryProvider for testing.
 *
 * This mock tracks all calls to add() and search() and allows
 * pre-seeding memories that will be returned from search().
 *
 * @example
 * ```typescript
 * const provider = createMockProvider();
 * provider.seedMemories([{ id: '1', content: 'User likes dark mode', score: 0.95 }]);
 *
 * // Use in brain
 * const testBrain = brain('test').withMemory(provider).step(...);
 * await collectEvents(testBrain.run({ client }));
 *
 * // Verify calls
 * expect(provider.getSearchCalls()).toHaveLength(1);
 * ```
 */
export function createMockProvider(): MockMemoryProvider {
  const addCalls: Array<{
    messages: MemoryMessage[];
    scope: MemoryScope;
    options?: { metadata?: Record<string, unknown> };
  }> = [];

  const searchCalls: Array<{
    query: string;
    scope: MemoryScope;
    options?: { limit?: number };
  }> = [];

  let seededMemories: Memory[] = [];

  return {
    async search(
      query: string,
      scope: MemoryScope,
      options?: { limit?: number }
    ): Promise<Memory[]> {
      searchCalls.push({ query, scope, options });
      return seededMemories;
    },

    async add(
      messages: MemoryMessage[],
      scope: MemoryScope,
      options?: { metadata?: Record<string, unknown> }
    ): Promise<void> {
      addCalls.push({ messages, scope, options });
    },

    getAddCalls: () => [...addCalls],
    getSearchCalls: () => [...searchCalls],
    seedMemories: (memories: Memory[]) => {
      seededMemories = memories;
    },
    reset: () => {
      addCalls.length = 0;
      searchCalls.length = 0;
      seededMemories = [];
    },
  };
}

/**
 * Creates a mock ObjectGenerator for testing brains.
 *
 * @example
 * ```typescript
 * const client = createMockClient();
 *
 * // Run brain
 * const testBrain = brain('test').step('process', () => ({ done: true }));
 * await collectEvents(testBrain.run({ client }));
 * ```
 */
export function createMockClient(): jest.Mocked<ObjectGenerator> {
  return {
    generateObject: jest.fn<ObjectGenerator['generateObject']>(),
    streamText: jest.fn<ObjectGenerator['streamText']>(),
  };
}

/**
 * Helper function to collect all events from a brain run.
 *
 * @example
 * ```typescript
 * const events = await collectEvents(brain.run({ client }));
 * expect(events.some(e => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
 * ```
 */
export async function collectEvents<T>(
  iterator: AsyncIterableIterator<T>
): Promise<T[]> {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}
