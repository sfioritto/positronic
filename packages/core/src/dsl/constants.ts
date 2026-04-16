export const BRAIN_EVENTS = {
  START: 'brain:start',
  STEP_START: 'step:start',
  STEP_COMPLETE: 'step:complete',
  STEP_STATUS: 'step:status',
  ERROR: 'brain:error',
  COMPLETE: 'brain:complete',
  CANCELLED: 'brain:cancelled',
  PAUSED: 'brain:paused',
  RESUMED: 'brain:resumed',
  WEBHOOK: 'brain:webhook',
  WEBHOOK_RESPONSE: 'brain:webhook_response',
  // Iterate events (prompt/brain with `over`)
  ITERATE_ITEM_COMPLETE: 'iterate:item_complete',
  // Prompt loop events
  PROMPT_START: 'prompt:start',
  PROMPT_ITERATION: 'prompt:iteration',
  PROMPT_TOOL_CALL: 'prompt:tool_call',
  PROMPT_TOOL_RESULT: 'prompt:tool_result',
  PROMPT_ASSISTANT_MESSAGE: 'prompt:assistant_message',
  PROMPT_COMPLETE: 'prompt:complete',
  PROMPT_TOKEN_LIMIT: 'prompt:token_limit',
  PROMPT_ITERATION_LIMIT: 'prompt:iteration_limit',
  PROMPT_RAW_RESPONSE_MESSAGE: 'prompt:raw_response_message',
  PROMPT_WEBHOOK: 'prompt:webhook',
  // File events
  FILE_WRITE_START: 'file:write_start',
  FILE_WRITE_COMPLETE: 'file:write_complete',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  WAITING: 'waiting',
  PAUSED: 'paused',
  HALTED: 'halted',
} as const;
