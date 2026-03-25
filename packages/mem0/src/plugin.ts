import { z } from 'zod';
import { definePlugin } from '@positronic/core';

import type { MemoryProvider } from '@positronic/core';

type Mem0ApiConfig = {
  /** Mem0 API key */
  apiKey: string;
  /** Base URL for the Mem0 API (defaults to https://api.mem0.ai) */
  baseUrl?: string;
  /** Organization ID (optional) */
  orgId?: string;
  /** Project ID (optional) */
  projectId?: string;
};

export type Mem0PluginConfig =
  | Mem0ApiConfig
  | {
      /** Custom provider (for testing or alternative backends) */
      provider: MemoryProvider;
    };

interface Mem0SearchResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Build a MemoryProvider that makes direct Mem0 API calls.
 *
 * Mem0 ignores agent_id when user_id is present, so we encode both into
 * a composite user_id: "userName/brainTitle". This gives strict per-brain
 * per-user isolation without relying on agent_id.
 */
function createMem0Provider(config: Mem0ApiConfig): MemoryProvider {
  const { apiKey, baseUrl = 'https://api.mem0.ai', orgId, projectId } = config;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Token ${apiKey}`,
  };

  if (orgId) headers['Mem0-Org-Id'] = orgId;
  if (projectId) headers['Mem0-Project-Id'] = projectId;

  function compositeUserId(scope: { agentId: string; userId?: string }) {
    return scope.userId && scope.agentId
      ? `${scope.userId}/${scope.agentId}`
      : scope.userId || scope.agentId;
  }

  return {
    async search(query, scope, options) {
      const body: Record<string, unknown> = {
        query,
        filters: { user_id: compositeUserId(scope) },
      };
      if (options?.limit) body.top_k = options.limit;

      const response = await fetch(`${baseUrl}/v2/memories/search/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Mem0 search failed (${response.status}): ${errorText}`
        );
      }

      const raw = await response.json();
      const results: Mem0SearchResult[] = Array.isArray(raw)
        ? raw
        : raw.memories ?? [];
      return results.map((result) => ({
        id: result.id,
        content: result.memory,
        score: result.score,
        metadata: result.metadata,
      }));
    },

    async add(messages, scope, options) {
      const body: Record<string, unknown> = {
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        user_id: compositeUserId(scope),
      };
      if (options?.metadata) body.metadata = options.metadata;

      const response = await fetch(`${baseUrl}/v1/memories/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mem0 add failed (${response.status}): ${errorText}`);
      }

      await response.json();
    },
  };
}

/**
 * Mem0 plugin for Positronic.
 *
 * Provides strictly scoped semantic memory (per-brain AND per-user) via
 * search/add methods and LLM tools (rememberFact, recallMemories).
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
    const provider =
      'provider' in config
        ? config.provider
        : createMem0Provider(config as Mem0ApiConfig);

    const memoryScope = {
      agentId: brainTitle,
      userId: currentUser.name,
    };

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
    };
  },
});
