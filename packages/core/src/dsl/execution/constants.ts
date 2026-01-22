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
 * Default system prompt prepended to all loop steps.
 * Explains tool execution quirks to the LLM.
 */
export const DEFAULT_LOOP_SYSTEM_PROMPT = `## Tool Execution Behavior
- Tools are executed sequentially in the order you call them
- If a tool triggers a webhook (e.g., human approval), remaining tools in your response will NOT execute - you'll need to call them again after resuming
- When waiting on multiple webhooks (e.g., Slack + email), the first webhook response received will resume execution
- Terminal tools end the loop immediately - no further tools or iterations will run

## Resumption Context
When resuming after a webhook response, that response appears as the tool result in your conversation history.`;

/**
 * Maximum number of retries for step execution.
 */
export const MAX_RETRIES = 1;
