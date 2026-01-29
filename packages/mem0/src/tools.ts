import { z } from 'zod';
import type { AgentTool, StepContext } from '@positronic/core';

/**
 * Schema for the rememberFact tool input
 */
const rememberFactSchema = z.object({
  fact: z.string().describe('The fact or information to remember for later'),
  userId: z
    .string()
    .optional()
    .describe('Optional user ID to associate this memory with'),
});

/**
 * Schema for the recallMemories tool input
 */
const recallMemoriesSchema = z.object({
  query: z.string().describe('The search query to find relevant memories'),
  userId: z
    .string()
    .optional()
    .describe('Optional user ID to scope the search'),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of memories to return'),
});

/**
 * Tool for storing facts in long-term memory.
 *
 * This tool allows the agent to store important information for future reference.
 * Facts are stored with the agent's scope and optionally a user ID.
 *
 * @example
 * ```typescript
 * const tools = createMem0Tools();
 *
 * const myBrain = brain('my-brain')
 *   .withMemory(memory)
 *   .brain('agent', ({ tools: defaultTools }) => ({
 *     system: 'You are helpful. Store user preferences with rememberFact.',
 *     prompt: 'User says: I prefer dark mode',
 *     tools: { ...defaultTools, ...tools },
 *   }));
 * ```
 */
export const rememberFact: AgentTool<typeof rememberFactSchema> = {
  description: `Store a fact or piece of information in long-term memory for future reference.

Use this tool when:
- The user shares a preference (e.g., "I like dark mode", "I prefer brief responses")
- The user provides important context (e.g., "I'm working on project X", "I'm a beginner")
- You learn something that should persist across conversations

The fact should be a clear, standalone statement that can be retrieved later.`,
  inputSchema: rememberFactSchema,
  async execute(
    input: z.infer<typeof rememberFactSchema>,
    context: StepContext
  ): Promise<{ remembered: boolean; fact: string }> {
    if (!context.memory) {
      return {
        remembered: false,
        fact: input.fact,
      };
    }

    await context.memory.add(
      [{ role: 'assistant', content: input.fact }],
      { userId: input.userId }
    );

    return {
      remembered: true,
      fact: input.fact,
    };
  },
};

/**
 * Tool for recalling memories from long-term storage.
 *
 * This tool allows the agent to search for and retrieve relevant memories.
 * Memories are searched within the agent's scope and optionally a user ID.
 *
 * @example
 * ```typescript
 * const tools = createMem0Tools();
 *
 * const myBrain = brain('my-brain')
 *   .withMemory(memory)
 *   .brain('agent', ({ tools: defaultTools }) => ({
 *     system: 'Use recallMemories to find relevant user preferences.',
 *     prompt: 'What theme does the user prefer?',
 *     tools: { ...defaultTools, ...tools },
 *   }));
 * ```
 */
export const recallMemories: AgentTool<typeof recallMemoriesSchema> = {
  description: `Search long-term memory for relevant information.

Use this tool to retrieve:
- User preferences and settings
- Previous context or decisions
- Facts learned in earlier interactions

The query should describe what you're looking for. Results include relevance scores.`,
  inputSchema: recallMemoriesSchema,
  async execute(
    input: z.infer<typeof recallMemoriesSchema>,
    context: StepContext
  ): Promise<{
    found: number;
    memories: Array<{ content: string; relevance?: number }>;
  }> {
    if (!context.memory) {
      return {
        found: 0,
        memories: [],
      };
    }

    const memories = await context.memory.search(input.query, {
      userId: input.userId,
      limit: input.limit,
    });

    return {
      found: memories.length,
      memories: memories.map((m) => ({
        content: m.content,
        relevance: m.score,
      })),
    };
  },
};

/**
 * Creates the standard Mem0 memory tools.
 *
 * Returns an object with `rememberFact` and `recallMemories` tools
 * that can be spread into your agent's tools configuration.
 *
 * @returns Object containing memory tools
 *
 * @example
 * ```typescript
 * import { createMem0Tools } from '@positronic/mem0';
 *
 * const memoryTools = createMem0Tools();
 *
 * const myBrain = brain('my-brain')
 *   .withMemory(provider)
 *   .brain('agent', () => ({
 *     system: 'You can remember and recall information.',
 *     prompt: 'Help the user',
 *     tools: memoryTools,
 *   }));
 * ```
 */
export function createMem0Tools(): {
  rememberFact: typeof rememberFact;
  recallMemories: typeof recallMemories;
} {
  return {
    rememberFact,
    recallMemories,
  };
}
