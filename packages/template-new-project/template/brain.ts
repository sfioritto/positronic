import { createBrain, defaultTools } from '@positronic/core';
import { components } from './components/index.js';

/**
 * Project-level brain function with pre-configured components and tools.
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
 * Default tools available in agent steps:
 * - generateUI: Generate interactive UI components
 * - consoleLog: Log messages for debugging
 * - done: Complete the agent and return a result
 *
 * To add services (e.g., Slack, Gmail, database clients):
 *
 * ```typescript
 * import { createBrain, defaultTools } from '@positronic/core';
 * import { components } from './components/index.js';
 * import slack from './services/slack.js';
 * import gmail from './services/gmail.js';
 *
 * export const brain = createBrain({
 *   services: { slack, gmail },
 *   components,
 *   defaultTools,
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
 * You can also create agents directly with access to default tools:
 *
 * ```typescript
 * export default brain('my-agent', ({ slack, tools }) => ({
 *   system: 'You are a helpful assistant',
 *   prompt: 'Help the user with their request',
 *   tools: {
 *     ...tools, // includes generateUI, consoleLog, done
 *     notify: {
 *       description: 'Send a Slack notification',
 *       inputSchema: z.object({ message: z.string() }),
 *       execute: ({ message }) => slack.postMessage('#general', message),
 *     },
 *   },
 * }));
 * ```
 *
 * To add memory (long-term storage with semantic search):
 *
 * ```typescript
 * import { createBrain, defaultTools } from '@positronic/core';
 * import { createMem0Provider, createMem0Tools } from '@positronic/mem0';
 * import { components } from './components/index.js';
 *
 * const memory = createMem0Provider({
 *   apiKey: process.env.MEM0_API_KEY!,
 * });
 *
 * export const brain = createBrain({
 *   components,
 *   defaultTools,
 *   memory, // All brains now have access to memory
 * });
 *
 * // Memory tools (rememberFact, recallMemories) can be added to agents:
 * const memoryTools = createMem0Tools();
 * ```
 *
 * See docs/memory-guide.md for more details on memory configuration.
 */
export const brain = createBrain({
  components,
  defaultTools,
});
