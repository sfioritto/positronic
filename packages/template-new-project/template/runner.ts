import { BrainRunner } from '@positronic/core';
import { VercelClient } from '@positronic/client-vercel';
import { google } from '@ai-sdk/google';

/**
 * The BrainRunner executes brains with the configured client and adapters.
 *
 * ## AI Provider Setup
 *
 * By default this uses Google Gemini. Set GOOGLE_GENERATIVE_AI_API_KEY in
 * your .env file (get a key at https://aistudio.google.com/apikey).
 *
 * To switch to a different provider, install its Vercel AI SDK adapter
 * and swap the model below:
 *
 * **Anthropic (Claude):**
 * ```bash
 * npm install @ai-sdk/anthropic
 * ```
 * ```typescript
 * import { anthropic } from '@ai-sdk/anthropic';
 * const client = new VercelClient(anthropic('claude-sonnet-4-5-20250929'));
 * ```
 * Then set ANTHROPIC_API_KEY in your .env file.
 *
 * **OpenAI:**
 * ```bash
 * npm install @ai-sdk/openai
 * ```
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * const client = new VercelClient(openai('gpt-4o'));
 * ```
 * Then set OPENAI_API_KEY in your .env file.
 *
 * Any provider supported by the Vercel AI SDK works — just install the
 * package and pass the model to VercelClient.
 *
 * ## Memory
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
 * See docs/memory-guide.md for more details.
 */
const client = new VercelClient(google('gemini-3-pro-preview'));

export const runner = new BrainRunner({
  adapters: [],
  client,
  resources: {},
});
