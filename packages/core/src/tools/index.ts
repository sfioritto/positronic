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
    'Instructions for what UI to generate. Describe the layout and purpose. ' +
    'Be specific about what you want to display or collect from the user.'
  ),
  hasForm: z.boolean().optional().describe(
    'If true (default), creates a form with a webhook for submission. ' +
    'Set to false for display-only pages.'
  ),
});

/**
 * Generate UI tool - creates an interactive UI page.
 *
 * This tool:
 * 1. Uses an LLM to generate a UI page based on your prompt
 * 2. Creates an HTML page with the generated components
 * 3. Returns the page URL and webhook info (if hasForm is true)
 *
 * IMPORTANT: This tool does NOT pause execution. After generating a page with a form,
 * you must call waitForWebhook to pause and wait for the form submission.
 * Before calling waitForWebhook, ensure the user knows the page URL.
 *
 * Requires components and pages to be configured via createBrain or withComponents().
 *
 * The description is enriched at runtime with available component information.
 */
export const generateUI: AgentTool<typeof generateUIInputSchema> = {
  description: 'Generate a UI page to display to the user. ' +
    'Returns a URL and optional webhook info. ' +
    'IMPORTANT: This does NOT pause execution. ' +
    'If the page has a form (hasForm: true, the default), you must: ' +
    '1) Tell the user the page URL so they can access it, then ' +
    '2) Call waitForWebhook with the returned webhook info to pause and wait for submission.',
  inputSchema: generateUIInputSchema,
  async execute(input, context): Promise<{ url: string; webhook: { slug: string; identifier: string } | null }> {
    const { components, pages, client, state, env, brainRunId, stepId } = context;
    const hasForm = input.hasForm ?? true;

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

    // Create webhook info only if hasForm is true
    let webhookInfo: { slug: string; identifier: string } | null = null;
    let formAction: string | undefined;

    if (hasForm) {
      const webhookIdentifier = `${brainRunId}-${stepId}-generateui-${Date.now()}`;
      formAction = `${env.origin}/webhooks/system/ui-form?identifier=${encodeURIComponent(webhookIdentifier)}`;
      webhookInfo = {
        slug: 'ui-form',
        identifier: webhookIdentifier,
      };
    }

    // Generate HTML page
    const html = generatePageHtml({
      placements: uiResult.placements,
      rootId: uiResult.rootId,
      data: state as Record<string, unknown>,
      title: hasForm ? 'Generated Form' : 'Generated Page',
      formAction,
    });

    // Create the page
    const page = await pages.create(html);

    // Return URL and webhook info (no waitFor - does not pause)
    return {
      url: page.url,
      webhook: webhookInfo,
    };
  },
};

const waitForWebhookInputSchema = z.object({
  slug: z.string().describe('The webhook slug from generateUI (e.g., "ui-form")'),
  identifier: z.string().describe('The unique webhook identifier from generateUI'),
});

/**
 * Wait for webhook tool - pauses execution until a webhook receives a response.
 *
 * Use this after generating a UI page with a form to wait for the user's submission.
 * The form data will be returned as the tool result when the webhook fires.
 *
 * IMPORTANT: Before calling this tool, ensure the user knows the page URL
 * so they can access and submit the form.
 */
export const waitForWebhook: AgentTool<typeof waitForWebhookInputSchema> = {
  description: 'Pause execution and wait for a webhook response (e.g., form submission). ' +
    'Call this after generating a UI page with a form. ' +
    'IMPORTANT: Ensure the user knows the page URL before calling this, ' +
    'otherwise they will not be able to access the form.',
  inputSchema: waitForWebhookInputSchema,
  execute(input): AgentToolWaitFor {
    const webhook: WebhookRegistration = {
      slug: input.slug,
      identifier: input.identifier,
      schema: z.record(z.unknown()),
    };

    return {
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
 * Default schema for the auto-generated 'done' tool when no outputSchema is provided.
 * Used internally by the framework.
 */
export const defaultDoneSchema = z.object({
  result: z.string().describe('The final result or summary of the completed task'),
});

/**
 * Default tools bundle.
 *
 * Use with createBrain's defaultTools option or .withTools() to include
 * standard tools in your brain. Tools can be extended or overridden in
 * individual agent steps.
 *
 * Note: A 'done' terminal tool is automatically generated for every agent.
 * If you provide an outputSchema, 'done' will use that schema. Otherwise,
 * it uses a default schema expecting { result: string }.
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
  waitForWebhook,
  consoleLog,
};
