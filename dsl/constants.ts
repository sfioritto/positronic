export const WORKFLOW_EVENTS = {
  START: 'workflow:start',
  RESTART: 'workflow:restart',
  UPDATE: 'workflow:update',
  ERROR: 'workflow:error',
  COMPLETE: 'workflow:complete',
} as const;

export const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;