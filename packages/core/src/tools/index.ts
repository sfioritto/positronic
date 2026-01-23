import { z } from 'zod';
import type { AgentTool, AgentToolWaitFor } from '../dsl/types.js';
import { createWebhook } from '../dsl/webhook.js';

/**
 * Helper function to create tools with proper type inference.
 *
 * This avoids the need to manually specify types on the execute function -
 * TypeScript will infer them from the inputSchema.
 *
 * @example
 * ```typescript
 * const sendNotification = createTool({
 *   description: 'Send a push notification',
 *   inputSchema: z.object({
 *     message: z.string().describe('The notification message'),
 *     clickUrl: z.string().optional().describe('URL to open on click'),
 *   }),
 *   execute: async ({ message, clickUrl }) => {  // Types inferred!
 *     await ntfy.send(message, clickUrl);
 *     return { sent: true };
 *   },
 * });
 * ```
 */
export function createTool<T extends z.ZodSchema>(config: {
  description: string;
  inputSchema: T;
  execute?: (input: z.infer<T>) => unknown | Promise<unknown> | AgentToolWaitFor | Promise<AgentToolWaitFor>;
  terminal?: boolean;
}): AgentTool<T> {
  return config;
}

/**
 * Default generateUI tool - gets enriched with component metadata at runtime.
 *
 * This tool allows the LLM to generate a UI and wait for user response.
 * The actual component list and descriptions are injected at runtime
 * based on the components registered with .withComponents().
 */
export const generateUI = createTool({
  description: 'Generate a UI to display to the user and wait for their response',
  inputSchema: z.object({
    component: z.string().describe('The component name to render'),
    props: z.record(z.unknown()).describe('Props to pass to the component'),
  }),
  execute(input): AgentToolWaitFor {
    // Return waitFor to pause execution until user responds
    // The actual webhook handling is done by the runtime
    const uiWebhook = createWebhook(
      'ui-response',
      z.object({
        userResponse: z.unknown(),
      }),
      async () => ({
        type: 'webhook' as const,
        identifier: 'pending',
        response: { userResponse: null },
      })
    );
    return {
      waitFor: uiWebhook('pending'),
    };
  },
});

/**
 * Console log tool - useful for debugging and logging information during agent execution.
 */
export const consoleLog = createTool({
  description: 'Log a message to the console for debugging or informational purposes',
  inputSchema: z.object({
    message: z.string().describe('The message to log'),
    level: z.enum(['info', 'warn', 'error']).optional().describe('Log level (defaults to info)'),
  }),
  execute: ({ message, level = 'info' }) => {
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(`[Agent] ${message}`);
    return { logged: true };
  },
});

/**
 * Done tool - a simple terminal tool for completing agent execution.
 * The result becomes part of the brain state.
 */
export const done = createTool({
  description: 'Complete the task and return a result',
  inputSchema: z.object({
    result: z.string().describe('The final result or summary of the completed task'),
  }),
  terminal: true,
});

/**
 * Default tools bundle.
 *
 * Use with createBrain's defaultTools option or .withTools() to include
 * standard tools in your brain. Tools can be extended or overridden in
 * individual agent steps.
 *
 * @example
 * ```typescript
 * import { createBrain, defaultTools } from '@positronic/core';
 *
 * export const brain = createBrain({
 *   components,
 *   defaultTools,
 * });
 *
 * // Or with the builder pattern:
 * const myBrain = brain('my-brain')
 *   .withTools(defaultTools)
 *   .brain('agent', ({ tools }) => ({
 *     system: 'You are helpful',
 *     prompt: 'Help the user',
 *     tools  // uses defaultTools
 *   }));
 * ```
 */
export const defaultTools = {
  generateUI,
  consoleLog,
  done,
};
