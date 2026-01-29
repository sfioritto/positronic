import type {
  MemoryProvider,
  MemoryScope,
  MemoryMessage,
  Memory,
} from '@positronic/core';

/**
 * Configuration for the Mem0 memory provider.
 */
export interface Mem0Config {
  /** Mem0 API key */
  apiKey: string;
  /** Base URL for the Mem0 API (defaults to https://api.mem0.ai/v1) */
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
 *   .withMemory(memory)
 *   .brain('agent', async ({ memory }) => {
 *     const prefs = await memory.search('user preferences');
 *     return { system: `Preferences: ${prefs}`, prompt: 'Help' };
 *   });
 * ```
 */
export function createMem0Provider(config: Mem0Config): MemoryProvider {
  const {
    apiKey,
    baseUrl = 'https://api.mem0.ai/v1',
    orgId,
    projectId,
  } = config;

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
    ): Promise<Memory[]> {
      const body: Record<string, unknown> = {
        query,
        agent_id: scope.agentId,
      };

      if (scope.userId) {
        body.user_id = scope.userId;
      }

      if (options?.limit) {
        body.limit = options.limit;
      }

      const response = await fetch(`${baseUrl}/memories/search/`, {
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
      const body: Record<string, unknown> = {
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        agent_id: scope.agentId,
      };

      if (scope.userId) {
        body.user_id = scope.userId;
      }

      if (options?.metadata) {
        body.metadata = options.metadata;
      }

      const response = await fetch(`${baseUrl}/memories/`, {
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
