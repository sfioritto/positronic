import type {
  MemoryProvider,
  Memory,
  MemorySearchOptions,
  MemoryAddOptions,
  MemoryMessage,
  MemoryEntry,
} from './types.js';

/**
 * Creates a scoped memory instance with agentId and userId pre-bound.
 *
 * This wraps a MemoryProvider and automatically includes the agentId
 * and userId in all calls, so brain steps don't need to pass them explicitly.
 *
 * @param provider - The underlying memory provider
 * @param agentId - The agent/brain ID to scope memories to
 * @param userId - The user name to scope memories to (from currentUser.name)
 * @returns A Memory instance
 *
 * @example
 * ```typescript
 * const provider = createMem0Provider({ apiKey: '...' });
 * const scopedMemory = createScopedMemory(provider, 'my-brain', 'user-123');
 *
 * // Now search without passing agentId or userId
 * const memories = await scopedMemory.search('user preferences');
 * ```
 */
export function createScopedMemory(
  provider: MemoryProvider,
  agentId: string,
  userId: string
): Memory {
  return {
    async search(
      query: string,
      options?: MemorySearchOptions
    ): Promise<MemoryEntry[]> {
      const scope = { agentId, userId };
      return provider.search(query, scope, { limit: options?.limit });
    },

    async add(
      messages: MemoryMessage[],
      options?: MemoryAddOptions
    ): Promise<void> {
      const scope = { agentId, userId };
      return provider.add(messages, scope, { metadata: options?.metadata });
    },
  };
}
