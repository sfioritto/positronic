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
 * ## Adding services
 *
 * ```typescript
 * import { createBrain } from '@positronic/core';
 * import { components } from './components/index.js';
 * import slack from './services/slack.js';
 * import gmail from './services/gmail.js';
 *
 * export const brain = createBrain({
 *   services: { slack, gmail },
 *   components,
 * });
 * ```
 *
 * Then services are available in all brain steps:
 *
 * ```typescript
 * export default brain('notify')
 *   .step('Send alert', ({ slack }) => {
 *     slack.postMessage('#alerts', 'Something happened!');
 *     return { notified: true };
 *   });
 * ```
 *
 * To add memory (long-term storage with semantic search),
 * call `.withMemory()` on individual brains that need it:
 *
 * ```typescript
 * export default brain('my-brain')
 *   .withMemory()
 *   .step('Remember', async ({ memory }) => {
 *     const prefs = await memory.search('user preferences');
 *     return { preferences: prefs };
 *   });
 * ```
 *
 * The memory provider is configured on the runner, not in createBrain.
 * Memory is automatically scoped to the current user and brain name.
 *
 * See docs/memory-guide.md for full details.
 */
export const brain = createBrain({
  components,
});
