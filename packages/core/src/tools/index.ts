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
    'Natural language instructions describing the UI to generate. ' +
    'Include: (1) the purpose of the page, (2) what information to display from state data, ' +
    '(3) what input fields are needed if collecting data, (4) labels and placeholders for fields, ' +
    '(5) any specific layout preferences. Example: "Create a form to collect user feedback with ' +
    'fields for rating (1-5 scale), comments (text area), and email. Show the product name from state at the top."'
  ),
  hasForm: z.boolean().optional().describe(
    'Whether to include a form that can be submitted. Defaults to true. ' +
    'Set to true when: collecting user input, approval workflows, any interactive data entry. ' +
    'Set to false when: displaying read-only information, confirmation pages, dashboards. ' +
    'When true, the tool returns webhook info that must be used with waitForWebhook to receive the submission.'
  ),
  persist: z.boolean().optional().describe(
    'Whether to keep the page after the brain run completes. Defaults to false. ' +
    'Set to false (default): Page is automatically cleaned up when the brain run finishes. Use for one-time forms, approvals, or temporary displays. ' +
    'Set to true: Page survives brain completion and remains accessible. Use for shared dashboards, permanent reference pages, or pages that need to outlive the workflow.'
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
  description: `Generate a web page for displaying rich content or collecting user input.

Sometimes you need more than simple notifications to communicate with users. This tool creates web pages that can display formatted content, dashboards, or forms to collect information.

RETURNS: { url: string, webhook: { slug: string, identifier: string } | null }
- url: The page URL
- webhook: For forms (hasForm=true), contains slug and identifier that can be passed to waitForWebhook to pause execution until the user submits the form

IMPORTANT: Users have no way to discover the page URL on their own. After generating a page, you must tell them the URL using whatever communication tools are available.`,
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
    const page = await pages.create(html, { persist: input.persist });

    // Return URL and webhook info (no waitFor - does not pause)
    return {
      url: page.url,
      webhook: webhookInfo,
    };
  },
};

const waitForWebhookInputSchema = z.object({
  slug: z.string().describe(
    'The webhook slug that identifies the type of webhook. ' +
    'For generateUI forms, this is always "ui-form". ' +
    'Use the exact slug value returned by the tool that created the webhook.'
  ),
  identifier: z.string().describe(
    'The unique identifier for this specific webhook instance. ' +
    'This is returned by generateUI in webhook.identifier. ' +
    'Each generateUI call creates a unique identifier - use the one from the specific page you want to wait for.'
  ),
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
  description: `Pause agent execution and wait for an external event (webhook response).

PURPOSE: Suspend the agent until a user action occurs, such as submitting a form generated by generateUI.

⚠️ CRITICAL - BEFORE CALLING THIS TOOL:
You MUST have already communicated the page URL to the user in your response. The user has no other way to discover the URL. If you call this tool without first telling the user where to go, the job will freeze indefinitely with no easy recovery.

CORRECT SEQUENCE:
1. Call generateUI to create the page
2. In your response text, tell the user the URL (e.g., "Please complete the form at: {url}")
3. THEN call waitForWebhook

BEHAVIOR:
- Calling this tool immediately pauses execution
- The agent will NOT continue until the webhook receives data
- This pause is indefinite - there is no timeout
- When the webhook fires, execution resumes with the webhook payload as this tool's result
- The form data will be available as key-value pairs (e.g., { name: "John", email: "john@example.com" })

WHEN TO USE:
- After generateUI with hasForm=true, to wait for form submission
- Any workflow requiring human input or approval before continuing

FAILURE MODE: If the user doesn't know the URL, they cannot submit the form, and the agent waits forever. The only recovery is to kill the job or manually inspect the event stream for the URL.

RETURNS: The webhook payload when triggered. For UI forms, this contains all form field values as an object.`,
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
 * Print tool - the simplest way for agents to communicate with users.
 * Like PRINT in BASIC - outputs a message that users can see.
 */
export const print = createTool({
  description: `Display a message to the user. This is the simplest way to communicate with users.

Use this tool whenever you need to tell the user something - status updates, instructions, results, or any information they should see. The message will be displayed to users watching this workflow.`,
  inputSchema: z.object({
    message: z.string().describe('The message to display to the user'),
  }),
  execute: ({ message }) => {
    console.log(`[Print] ${message}`);
    return { printed: true };
  },
});

/**
 * Console log tool - for internal server-side debugging and logging.
 * NOT for user communication - use print for that.
 */
export const consoleLog = createTool({
  description: `Write a debug log message to the server console. For internal debugging only - users do not see these messages. Use 'print' to communicate with users.`,
  inputSchema: z.object({
    message: z.string().describe('The debug message to log'),
    level: z.enum(['info', 'warn', 'error']).optional().describe('Log level: info (default), warn, or error'),
  }),
  execute: ({ message, level = 'info' }) => {
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(`[Debug] ${message}`);
    return { logged: true };
  },
});

/**
 * Default schema for the auto-generated 'done' tool when no outputSchema is provided.
 * Used internally by the framework.
 */
export const defaultDoneSchema = z.object({
  result: z.string().describe(
    'A clear summary of what was accomplished. ' +
    'Include: key outcomes, any important values or findings, and confirmation that the task is complete. ' +
    'Be specific but concise. Example: "Successfully processed 15 orders totaling $1,234.56. All items shipped."'
  ),
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
  print,
  consoleLog,
};
