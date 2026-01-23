import type { RuntimeEnv } from '../types.js';

/**
 * Default runtime environment used when env is not provided.
 * This ensures backward compatibility with existing code.
 */
export const DEFAULT_ENV: RuntimeEnv = {
  origin: 'http://localhost:3000',
  secrets: {},
};

/**
 * Default system prompt prepended to all agent steps.
 * Explains the headless nature of Positronic Brains.
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = `## You Are a Positronic Brain

You are running as an automated agent in a headless workflow. This is NOT a chat interface - there is no user watching your text output.

**To communicate with users, you MUST use tool calls.** Look at your available tools and use them to send messages, notifications, or create pages for user interaction.

## Tool Execution
- Tools execute sequentially in the order you call them
- Webhook-triggering tools pause execution until the webhook fires
- Terminal tools (like 'done') end the agent immediately

## Resumption
When resuming after a webhook, that response appears as the tool result in your conversation history.`;

/**
 * Maximum number of retries for step execution.
 */
export const MAX_RETRIES = 1;
