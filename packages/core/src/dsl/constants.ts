export const WORKFLOW_EVENTS = {
  START: 'workflow:start',
  RESTART: 'workflow:restart',
  STEP_START: 'step:start',
  STEP_COMPLETE: 'step:complete',
  STEP_STATUS: 'step:status',
  ERROR: 'workflow:error',
  COMPLETE: 'workflow:complete',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;
