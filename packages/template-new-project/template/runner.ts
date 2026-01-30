import { BrainRunner } from '@positronic/core';
import { VercelClient } from '@positronic/client-vercel';
import { google } from '@ai-sdk/google';

/**
 * The BrainRunner executes brains with the configured client and adapters.
 *
 * To add memory (automatic conversation indexing with Mem0):
 *
 * ```typescript
 * import { createMem0Provider, createMem0Adapter } from '@positronic/mem0';
 *
 * const provider = createMem0Provider({
 *   apiKey: process.env.MEM0_API_KEY!,
 * });
 *
 * const memoryAdapter = createMem0Adapter({ provider });
 *
 * export const runner = new BrainRunner({
 *   adapters: [memoryAdapter],
 *   client: new VercelClient(google('gemini-3-pro-preview')),
 *   resources: {},
 * });
 * ```
 *
 * The adapter automatically indexes all agent conversations to memory.
 * See docs/memory-guide.md for more details.
 */
export const runner = new BrainRunner({
  adapters: [],
  client: new VercelClient(google('gemini-3-pro-preview')),
  resources: {},
});