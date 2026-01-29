import type {
  MemoryProvider,
  ScopedMemory,
  MemorySearchOptions,
  MemoryAddOptions,
  MemoryMessage,
  Memory,
} from './types.js';

/**
 * Creates a scoped memory instance with the agentId pre-bound.
 *
 * This wraps a MemoryProvider and automatically includes the agentId
 * in all calls, so brain steps don't need to pass it explicitly.
 *
 * @param provider - The underlying memory provider
 * @param agentId - The agent/brain ID to scope memories to
 * @returns A ScopedMemory instance
 *
 * @example
 * ```typescript
 * const provider = createMem0Provider({ apiKey: '...' });
 * const scopedMemory = createScopedMemory(provider, 'my-brain');
 *
 * // Now search without passing agentId
 * const memories = await scopedMemory.search('user preferences');
 * ```
 */
export function createScopedMemory(
  provider: MemoryProvider,
  agentId: string
): ScopedMemory {
  return {
    async search(
      query: string,
      options?: MemorySearchOptions
    ): Promise<Memory[]> {
      const scope = {
        agentId,
        userId: options?.userId,
      };
      return provider.search(query, scope, { limit: options?.limit });
    },

    async add(
      messages: MemoryMessage[],
      options?: MemoryAddOptions
    ): Promise<void> {
      const scope = {
        agentId,
        userId: options?.userId,
      };
      return provider.add(messages, scope, { metadata: options?.metadata });
    },
  };
}
