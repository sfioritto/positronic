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
 * To add services (e.g., Slack, Gmail, database clients):
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
 * You can also create agents directly:
 *
 * ```typescript
 * export default brain('my-agent', ({ slack, env }) => ({
 *   system: 'You are a helpful assistant',
 *   prompt: 'Help the user with their request',
 *   tools: {
 *     notify: {
 *       description: 'Send a Slack notification',
 *       inputSchema: z.object({ message: z.string() }),
 *       execute: ({ message }) => slack.postMessage('#general', message),
 *     },
 *     done: {
 *       description: 'Complete the task',
 *       inputSchema: z.object({ result: z.string() }),
 *       terminal: true,
 *     },
 *   },
 * }));
 * ```
 */
export const brain = createBrain({
  components,
});
