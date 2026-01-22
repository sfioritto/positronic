import { z } from 'zod';
import type { AgentTool, AgentToolWaitFor } from '../dsl/types.js';
import { createWebhook } from '../dsl/webhook.js';

/**
 * Default generateUI tool - gets enriched with component metadata at runtime.
 *
 * This tool allows the LLM to generate a UI and wait for user response.
 * The actual component list and descriptions are injected at runtime
 * based on the components registered with .withComponents().
 */
export const generateUI: AgentTool = {
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
};

/**
 * Default tools bundle.
 *
 * Use with .withTools(defaultTools) to include standard tools in your brain.
 * Tools can be extended or overridden in individual agent steps.
 *
 * @example
 * ```typescript
 * import { brain, defaultTools } from '@positronic/core';
 *
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
};
