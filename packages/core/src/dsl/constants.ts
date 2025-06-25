export const BRAIN_EVENTS = {
  START: 'brain:start',
  RESTART: 'brain:restart',
  STEP_START: 'step:start',
  STEP_COMPLETE: 'step:complete',
  STEP_STATUS: 'step:status',
  ERROR: 'brain:error',
  COMPLETE: 'brain:complete',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;
