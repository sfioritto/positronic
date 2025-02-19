export const initSQL = `
-- Workflow Runs
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_name TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,  -- JSON
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    -- Add JSON validation checks
    CONSTRAINT valid_error CHECK (error IS NULL OR json_valid(error))
);

CREATE TRIGGER IF NOT EXISTS workflow_runs_status_check
AFTER INSERT ON workflow_runs
WHEN NEW.status NOT IN ('pending', 'running', 'complete', 'error')
BEGIN
    SELECT RAISE(ROLLBACK, 'Invalid status value');
END;

CREATE TABLE IF NOT EXISTS workflow_steps (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    patch TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    step_order INTEGER NOT NULL,
    CONSTRAINT valid_patch CHECK (patch IS NULL OR json_valid(patch))
);

CREATE TRIGGER IF NOT EXISTS workflow_steps_status_check
AFTER INSERT ON workflow_steps
WHEN NEW.status NOT IN ('pending', 'running', 'complete', 'error')
BEGIN
    SELECT RAISE(ROLLBACK, 'Invalid status value');
END;

CREATE INDEX IF NOT EXISTS workflow_steps_workflow_run_id_idx ON workflow_steps(workflow_run_id);
`;