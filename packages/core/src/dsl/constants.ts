export const BRAIN_EVENTS = {
  START: 'brain:start',
  // RESTART is deprecated - use START for all brain starts (fresh or resume)
  // Kept temporarily for backwards compatibility during transition
  RESTART: 'brain:restart',
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
