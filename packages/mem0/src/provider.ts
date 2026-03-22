import type {
  MemoryProvider,
  MemoryScope,
  MemoryMessage,
  MemoryEntry,
} from '@positronic/core';

/**
 * Configuration for the Mem0 memory provider.
 */
export interface Mem0Config {
  /** Mem0 API key */
  apiKey: string;
  /** Base URL for the Mem0 API (defaults to https://api.mem0.ai) */
  baseUrl?: string;
  /** Organization ID (optional) */
  orgId?: string;
  /** Project ID (optional) */
  projectId?: string;
}

/**
 * Mem0 API response format for a single memory (search returns an array of these)
 */
interface Mem0SearchResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a Mem0 memory provider.
 *
 * @param config - Configuration for the Mem0 provider
 * @returns A MemoryProvider implementation
 *
 * @example
 * ```typescript
 * const memory = createMem0Provider({
 *   apiKey: process.env.MEM0_API_KEY!,
 *   projectId: 'my-project',
 * });
 *
 * const myBrain = brain('my-brain')
 *   .withMemory()
 *   .prompt('Chat', async ({ memory }) => {
 *     const prefs = await memory.search('user preferences');
 *     return { message: 'Help', outputSchema: z.object({ response: z.string() }) };
 *   });
 * ```
 */
export function createMem0Provider(config: Mem0Config): MemoryProvider {
  const { apiKey, baseUrl = 'https://api.mem0.ai', orgId, projectId } = config;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Token ${apiKey}`,
  };

  if (orgId) {
    headers['Mem0-Org-Id'] = orgId;
  }

  if (projectId) {
    headers['Mem0-Project-Id'] = projectId;
  }

  return {
    async search(
      query: string,
      scope: MemoryScope,
      options?: { limit?: number }
    ): Promise<MemoryEntry[]> {
      // Two-tier filter strategy:
      // - Mem0 treats user_id and agent_id as mutually exclusive scopes.
      //   A single record belongs to one or the other, never both.
      // - Tier 1 (agent-level): memories stored with agent_id, shared across all users.
      // - Tier 2 (per-user-per-agent): memories stored with user_id + metadata.associated_agent.
      // - When userId is present, search both tiers with an OR filter.
      // - When userId is absent, search only Tier 1 (agent-level).
      let filters: Record<string, unknown>;

      if (scope.userId) {
        filters = {
          OR: [
            { agent_id: scope.agentId },
            {
              AND: [
                { user_id: scope.userId },
                { metadata: { associated_agent: scope.agentId } },
              ],
            },
          ],
        };
      } else {
        filters = { agent_id: scope.agentId };
      }

      const body: Record<string, unknown> = {
        query,
        filters,
      };

      if (options?.limit) {
        body.top_k = options.limit;
      }

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

      const data = (await response.json()) as Mem0SearchResult[];

      return data.map((result) => ({
        id: result.id,
        content: result.memory,
        score: result.score,
        metadata: result.metadata,
      }));
    },

    async add(
      messages: MemoryMessage[],
      scope: MemoryScope,
      options?: { metadata?: Record<string, unknown> }
    ): Promise<void> {
      // Two-tier storage strategy:
      // - When userId is present, store as Tier 2 (per-user-per-agent):
      //   user_id as the primary scope, associated_agent in metadata.
      // - When userId is absent, store as Tier 1 (agent-level):
      //   agent_id as the primary scope.
      const body: Record<string, unknown> = {
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        version: 'v2',
      };

      if (scope.userId) {
        body.user_id = scope.userId;
        body.metadata = {
          ...options?.metadata,
          associated_agent: scope.agentId,
        };
      } else {
        body.agent_id = scope.agentId;
        if (options?.metadata) {
          body.metadata = options.metadata;
        }
      }

      const response = await fetch(`${baseUrl}/v1/memories/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mem0 add failed (${response.status}): ${errorText}`);
      }

      // We don't need to process the response, just ensure it succeeded
      await response.json();
    },
  };
}
