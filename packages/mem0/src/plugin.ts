import { z } from 'zod';
import { definePlugin } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';
import { createMem0Provider } from './provider.js';

import type { MemoryProvider } from '@positronic/core';

export type Mem0PluginConfig =
  | {
      /** Mem0 API key */
      apiKey: string;
      /** Base URL for the Mem0 API (defaults to https://api.mem0.ai) */
      baseUrl?: string;
      /** Organization ID (optional) */
      orgId?: string;
      /** Project ID (optional) */
      projectId?: string;
      /** Memory scope. Default: per-brain-per-user. 'user' = cross-brain. 'brain' = cross-user. */
      scope?: 'user' | 'brain';
      /** Whether the adapter should auto-index conversations on COMPLETE */
      autoIndex?: boolean;
    }
  | {
      /** Custom provider (for testing or alternative backends) */
      provider: MemoryProvider;
      scope?: 'user' | 'brain';
      autoIndex?: boolean;
    };

/**
 * Mem0 plugin for Positronic.
 *
 * Provides scoped memory search/add, tools for LLM tool-calling, and an adapter
 * that auto-indexes conversations.
 *
 * @example
 * ```typescript
 * import { mem0 } from '@positronic/mem0';
 *
 * const myBrain = brain('chat')
 *   .withPlugin(mem0.setup({ apiKey: process.env.MEM0_API_KEY! }))
 *   .prompt('Chat', ({ mem0: m }) => ({
 *     message: 'Help the user',
 *     outputSchema: z.object({ response: z.string() }),
 *     loop: { tools: { ...m.tools } },
 *   }));
 * ```
 */
export const mem0 = definePlugin({
  name: 'mem0',

  setup: (config: Mem0PluginConfig) => config,

  create: ({ config, brainTitle, currentUser }) => {
    const { scope, autoIndex = true } = config!;
    const provider =
      'provider' in config!
        ? config!.provider
        : createMem0Provider({
            apiKey: (config as any).apiKey,
            baseUrl: (config as any).baseUrl,
            orgId: (config as any).orgId,
            projectId: (config as any).projectId,
          });

    // Scoping logic
    const agentId = scope === 'user' ? '' : brainTitle;
    const userId = scope === 'brain' ? '' : currentUser.name;
    const memoryScope = { agentId, userId };

    // Scoped memory methods
    async function search(query: string, options?: { limit?: number }) {
      return provider.search(query, memoryScope, { limit: options?.limit });
    }

    async function add(
      messages: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
      }>,
      options?: { metadata?: Record<string, unknown> }
    ) {
      return provider.add(messages, memoryScope, {
        metadata: options?.metadata,
      });
    }

    // Conversation buffer for auto-indexing
    const buffer: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }> = [];

    return {
      search,
      add,

      tools: {
        rememberFact: {
          description: `Store a fact or piece of information in long-term memory for future reference.

Use this tool when:
- The user shares a preference (e.g., "I like dark mode", "I prefer brief responses")
- The user provides important context (e.g., "I'm working on project X", "I'm a beginner")
- You learn something that should persist across conversations

The fact should be a clear, standalone statement that can be retrieved later.`,
          inputSchema: z.object({
            fact: z
              .string()
              .describe('The fact or information to remember for later'),
          }),
          async execute(input: { fact: string }) {
            await add([{ role: 'assistant', content: input.fact }]);
            return { remembered: true, fact: input.fact };
          },
        },
        recallMemories: {
          description: `Search long-term memory for relevant information.

Use this tool to retrieve:
- User preferences and settings
- Previous context or decisions
- Facts learned in earlier interactions

The query should describe what you're looking for. Results include relevance scores.`,
          inputSchema: z.object({
            query: z
              .string()
              .describe('The search query to find relevant memories'),
            limit: z
              .number()
              .optional()
              .default(10)
              .describe('Maximum number of memories to return'),
          }),
          async execute(input: { query: string; limit?: number }) {
            const memories = await search(input.query, {
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
        },
      },

      adapter: {
        dispatch(event: any) {
          if (!autoIndex) return;

          if (event.type === BRAIN_EVENTS.COMPLETE) {
            if (buffer.length > 0) {
              provider.add([...buffer], memoryScope).then(() => {
                buffer.length = 0;
              });
            }
          }

          if (
            event.type === BRAIN_EVENTS.ERROR ||
            event.type === BRAIN_EVENTS.CANCELLED
          ) {
            buffer.length = 0;
          }
        },
      },
    };
  },
});
