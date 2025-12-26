export const BRAIN_EVENTS = {
  START: 'brain:start',
  RESTART: 'brain:restart',
  STEP_START: 'step:start',
  STEP_COMPLETE: 'step:complete',
  STEP_RETRY: 'step:retry',
  STEP_STATUS: 'step:status',
  ERROR: 'brain:error',
  COMPLETE: 'brain:complete',
  CANCELLED: 'brain:cancelled',
  WEBHOOK: 'brain:webhook',
  // Loop step events
  LOOP_START: 'loop:start',
  LOOP_ITERATION: 'loop:iteration',
  LOOP_TOOL_CALL: 'loop:tool_call',
  LOOP_TOOL_RESULT: 'loop:tool_result',
  LOOP_ASSISTANT_MESSAGE: 'loop:assistant_message',
  LOOP_COMPLETE: 'loop:complete',
  LOOP_TOKEN_LIMIT: 'loop:token_limit',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
} as const;
