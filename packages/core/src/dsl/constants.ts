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
  WEBHOOK_RESPONSE: 'brain:webhook_response',
  // Agent step events
  AGENT_START: 'agent:start',
  AGENT_ITERATION: 'agent:iteration',
  AGENT_TOOL_CALL: 'agent:tool_call',
  AGENT_TOOL_RESULT: 'agent:tool_result',
  AGENT_ASSISTANT_MESSAGE: 'agent:assistant_message',
  AGENT_COMPLETE: 'agent:complete',
  AGENT_TOKEN_LIMIT: 'agent:token_limit',
  AGENT_WEBHOOK: 'agent:webhook',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
} as const;
