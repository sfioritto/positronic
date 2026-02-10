export const BRAIN_EVENTS = {
  START: 'brain:start',
  // RESTART is deprecated - use START for all brain starts (fresh or resume)
  // Kept temporarily for backwards compatibility during transition
  RESTART: 'brain:restart',
  STEP_START: 'step:start',
  STEP_COMPLETE: 'step:complete',
  STEP_RETRY: 'step:retry',
  STEP_STATUS: 'step:status',
  ERROR: 'brain:error',
  COMPLETE: 'brain:complete',
  CANCELLED: 'brain:cancelled',
  PAUSED: 'brain:paused',
  RESUMED: 'brain:resumed',
  WEBHOOK: 'brain:webhook',
  WEBHOOK_RESPONSE: 'brain:webhook_response',
  // Agent step events
  AGENT_START: 'agent:start',
  AGENT_ITERATION: 'agent:iteration',
  AGENT_TOOL_CALL: 'agent:tool_call',
  AGENT_TOOL_RESULT: 'agent:tool_result',
  AGENT_ASSISTANT_MESSAGE: 'agent:assistant_message',
  AGENT_COMPLETE: 'agent:complete',
  AGENT_TOKEN_LIMIT: 'agent:token_limit',
  AGENT_ITERATION_LIMIT: 'agent:iteration_limit',
  AGENT_WEBHOOK: 'agent:webhook',
  AGENT_RAW_RESPONSE_MESSAGE: 'agent:raw_response_message',
  AGENT_USER_MESSAGE: 'agent:user_message',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  WAITING: 'waiting',
  PAUSED: 'paused',
  SKIPPED: 'skipped',
  // Internal status for tracking when execution is inside an agent loop.
  // Publicly this maps to RUNNING for consumers.
  AGENT_LOOP: 'agent_loop',
} as const;
