import { createBrain } from '@positronic/core';
import { components } from './components/index.js';

/**
 * Project-level brain function with pre-configured components.
 *
 * All brains in your project should import from this file:
 *
 * ```typescript
 * import { brain } from '../brain.js';
 *
 * export default brain('my-brain')
 *   .step('Do something', ({ state }) => ({ ...state, done: true }));
 * ```
 *
 * ## Prompt steps with tool-calling loops
 *
 * Use `.prompt()` with a `loop` property to run an LLM with tools:
 *
 * ```typescript
 * import { generatePage, waitForWebhook } from '@positronic/core';
 *
 * export default brain('my-brain')
 *   .prompt('Do Work', ({ state }) => ({
 *     system: 'You are a helpful assistant',
 *     message: `Help the user with: <%= '${state.task}' %>`,
 *     outputSchema: z.object({ result: z.string() }),
 *     loop: {
 *       tools: { generatePage, waitForWebhook },
 *     },
 *   }));
 * ```
 *
 * Without `loop`, `.prompt()` makes a single LLM call for structured output.
 * With `loop`, the LLM calls tools iteratively until it calls the auto-generated
 * 'done' tool with data matching the outputSchema.
 *
 * ## Adding plugins
 *
 * Plugins provide services, tools, and event adapters to brains.
 * Configure them in createBrain or per-brain with .withPlugin():
 *
 * ```typescript
 * import { createBrain } from '@positronic/core';
 * import { components } from './components/index.js';
 * import { mem0 } from '@positronic/mem0';
 *
 * export const brain = createBrain({
 *   plugins: [mem0.setup({ apiKey: process.env.MEM0_API_KEY! })],
 *   components,
 * });
 * ```
 *
 * Then plugin services are available in all brain steps under the plugin name:
 *
 * ```typescript
 * export default brain('my-brain')
 *   .step('Remember', async ({ mem0 }) => {
 *     const prefs = await mem0.search('user preferences');
 *     return { preferences: prefs };
 *   });
 * ```
 *
 * Or declare multiple plugins upfront:
 *
 * ```typescript
 * brain({ title: 'my-brain', plugins: { slack, mem0 } })
 *   .step('Go', ({ slack, mem0 }) => { ... });
 * ```
 */
export const brain = createBrain({
  components,
});
