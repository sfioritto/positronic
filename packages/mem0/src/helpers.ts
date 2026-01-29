import type { Memory, ScopedMemory, MemorySearchOptions } from '@positronic/core';

/**
 * Options for formatting memories.
 */
export interface FormatMemoriesOptions {
  /** Header text to include before the memories list */
  header?: string;
  /** Whether to include relevance scores (if available) */
  includeScores?: boolean;
  /** Text to return if no memories are found */
  emptyText?: string;
}

/**
 * Formats memories into a readable string format.
 *
 * @param memories - Array of memories to format
 * @param options - Formatting options
 * @returns Formatted string representation of the memories
 *
 * @example
 * ```typescript
 * const memories = await memory.search('user preferences');
 * const formatted = formatMemories(memories);
 * // Returns:
 * // 1. User prefers dark mode
 * // 2. User likes concise responses
 *
 * const formattedWithHeader = formatMemories(memories, {
 *   header: 'Known user preferences:',
 *   includeScores: true,
 * });
 * // Returns:
 * // Known user preferences:
 * // 1. User prefers dark mode (0.95)
 * // 2. User likes concise responses (0.82)
 * ```
 */
export function formatMemories(
  memories: Memory[],
  options: FormatMemoriesOptions = {}
): string {
  const {
    header,
    includeScores = false,
    emptyText = '',
  } = options;

  if (!memories || memories.length === 0) {
    return emptyText;
  }

  const lines: string[] = [];

  if (header) {
    lines.push(header);
  }

  memories.forEach((memory, index) => {
    let line = `${index + 1}. ${memory.content}`;
    if (includeScores && memory.score !== undefined) {
      line += ` (${memory.score.toFixed(2)})`;
    }
    lines.push(line);
  });

  return lines.join('\n');
}

/**
 * Options for creating a memory-augmented system prompt.
 */
export interface CreateMemorySystemPromptOptions extends MemorySearchOptions {
  /** Header text before the memories section */
  memoriesHeader?: string;
  /** Whether to include relevance scores */
  includeScores?: boolean;
}

/**
 * Creates a system prompt augmented with relevant memories.
 *
 * This is a convenience function that:
 * 1. Fetches relevant memories using the provided query
 * 2. Formats them nicely
 * 3. Appends them to your base system prompt
 *
 * @param memory - The scoped memory instance
 * @param basePrompt - The base system prompt
 * @param query - The search query for finding relevant memories
 * @param options - Search and formatting options
 * @returns The augmented system prompt
 *
 * @example
 * ```typescript
 * const myBrain = brain('my-brain')
 *   .withMemory(provider)
 *   .brain('agent', async ({ memory }) => {
 *     const system = await createMemorySystemPrompt(
 *       memory,
 *       'You are a helpful assistant.',
 *       'user preferences',
 *       { userId: 'user-123', memoriesHeader: '\n\nUser context:' }
 *     );
 *
 *     return { system, prompt: 'Help me with my task' };
 *   });
 * ```
 */
export async function createMemorySystemPrompt(
  memory: ScopedMemory,
  basePrompt: string,
  query: string,
  options: CreateMemorySystemPromptOptions = {}
): Promise<string> {
  const {
    userId,
    limit,
    memoriesHeader = '\n\nRelevant context from previous interactions:',
    includeScores = false,
  } = options;

  const memories = await memory.search(query, { userId, limit });

  if (memories.length === 0) {
    return basePrompt;
  }

  const formattedMemories = formatMemories(memories, {
    header: memoriesHeader,
    includeScores,
  });

  return `${basePrompt}${formattedMemories}`;
}

/**
 * Creates a memory context block for including in prompts.
 *
 * Similar to createMemorySystemPrompt but returns just the memory
 * context block, not the full system prompt. Useful when you want
 * more control over prompt construction.
 *
 * @param memory - The scoped memory instance
 * @param query - The search query for finding relevant memories
 * @param options - Search and formatting options
 * @returns Formatted memory context block or empty string
 *
 * @example
 * ```typescript
 * const context = await getMemoryContext(memory, 'user preferences', {
 *   userId: 'user-123',
 *   limit: 5,
 * });
 *
 * const system = `You are helpful.
 *
 * ${context ? `User context:\n${context}` : ''}`;
 * ```
 */
export async function getMemoryContext(
  memory: ScopedMemory,
  query: string,
  options: MemorySearchOptions = {}
): Promise<string> {
  const memories = await memory.search(query, options);
  return formatMemories(memories, { emptyText: '' });
}
