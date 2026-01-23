import { z } from 'zod';
import type { AgentTool, AgentToolWaitFor, StepContext } from '../dsl/types.js';
import type { WebhookRegistration } from '../dsl/webhook.js';
import { generateUI as generateUICore } from '../ui/generate-ui.js';
import { generatePageHtml } from '../ui/generate-page-html.js';

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
 *   execute: async ({ message, clickUrl }, context) => {
 *     await ntfy.send(message, clickUrl);
 *     return { sent: true };
 *   },
 * });
 * ```
 */
export function createTool<T extends z.ZodSchema>(config: {
  description: string;
  inputSchema: T;
  execute?: (
    input: z.infer<T>,
    context: StepContext
  ) => unknown | Promise<unknown> | AgentToolWaitFor | Promise<AgentToolWaitFor>;
  terminal?: boolean;
}): AgentTool<T> {
  return config;
}

const generateUIInputSchema = z.object({
  prompt: z.string().describe(
    'Instructions for what UI to generate. Describe the form fields, layout, and purpose. ' +
    'Be specific about what data you want to collect from the user.'
  ),
});

/**
 * Generate UI tool - creates an interactive UI page and waits for user response.
 *
 * This tool:
 * 1. Uses an LLM to generate a UI page based on your prompt
 * 2. Creates an HTML page with the generated components
 * 3. Pauses agent execution until the user submits the form
 * 4. Returns the form data as the tool result when resumed
 *
 * Requires components and pages to be configured via createBrain or withComponents().
 *
 * The description is enriched at runtime with available component information.
 */
export const generateUI: AgentTool<typeof generateUIInputSchema> = {
  description: 'Generate a UI page to display to the user and wait for their response. ' +
    'Available components will be listed in the system prompt. ' +
    'After the page is created, execution pauses until the user submits the form.',
  inputSchema: generateUIInputSchema,
  async execute(input, context): Promise<AgentToolWaitFor & { url: string }> {
    const { components, pages, client, state, env, brainRunId, stepId } = context;

    if (!components || Object.keys(components).length === 0) {
      throw new Error(
        'generateUI requires components to be configured. ' +
        'Use createBrain({ components }) or brain.withComponents() to register UI components.'
      );
    }

    if (!pages) {
      throw new Error(
        'generateUI requires pages service to be configured. ' +
        'This is typically provided by the backend runtime.'
      );
    }

    // Generate the UI using the core generateUI function
    const uiResult = await generateUICore({
      client,
      prompt: input.prompt,
      components,
      data: state as Record<string, unknown>,
    });

    if (!uiResult.rootId) {
      const placementCount = uiResult.placements.length;
      if (placementCount === 0) {
        throw new Error(
          `UI generation failed - no components were generated. ` +
          `The LLM may not have understood the prompt. Try being more specific.`
        );
      } else {
        throw new Error(
          `UI generation failed - no root component found. ` +
          `${placementCount} component(s) were placed but all have a parentId.`
        );
      }
    }

    // Create unique identifier for the webhook
    const webhookIdentifier = `${brainRunId}-${stepId}-generateui-${Date.now()}`;

    // Build form action URL
    const formAction = `${env.origin}/webhooks/system/ui-form?identifier=${encodeURIComponent(webhookIdentifier)}`;

    // Generate HTML page
    const html = generatePageHtml({
      placements: uiResult.placements,
      rootId: uiResult.rootId,
      data: state as Record<string, unknown>,
      title: 'Generated Form',
      formAction,
    });

    // Create the page
    const page = await pages.create(html);

    // Create webhook registration for form submission
    const webhook: WebhookRegistration = {
      slug: 'ui-form',
      identifier: webhookIdentifier,
      schema: z.record(z.unknown()),
    };

    // Return URL and waitFor - the URL is included so it can be logged/emitted
    return {
      url: page.url,
      waitFor: webhook,
    };
  },
};

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
