import type {
    Adapter,
    WorkflowEvent,
    WorkflowStartEvent,
    WorkflowCompleteEvent,
    WorkflowErrorEvent,
    StepStatusEvent,
} from '@positronic/core';
import { WORKFLOW_EVENTS } from '@positronic/core';
import type { SqlStorage } from '@cloudflare/workers-types';

// Simplified schema creation, only the workflow_runs table
const initSQL = `
CREATE TABLE IF NOT EXISTS workflow_run (
    workflow_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'complete', 'error')),
    error TEXT CHECK (error IS NULL OR json_valid(error)),
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS workflow_run_steps (
    step_id TEXT PRIMARY KEY,
    step_title TEXT NOT NULL,
    status TEXT NOT NULL,
    patch TEXT CHECK (patch IS NULL OR json_valid(patch))
);
`;

export class WorkflowRunSQLiteAdapter implements Adapter {
    private sql: SqlStorage;

    constructor(sql: SqlStorage) {
        this.sql = sql;
    }

    private async initializeSchema() {
        await this.sql.exec(initSQL);
    }

    public async dispatch(event: WorkflowEvent) {
        try {
            if (event.type === WORKFLOW_EVENTS.START || event.type === WORKFLOW_EVENTS.RESTART) {
                await this.handleWorkflowStart(event);
            } else if (event.type === WORKFLOW_EVENTS.COMPLETE) {
                await this.handleComplete(event);
            } else if (event.type === WORKFLOW_EVENTS.ERROR) {
                await this.handleWorkflowError(event);
            } else if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
                await this.handleStepStatus(event);
            }
            // NOTE: Intentionally not adding the call to handleStepStatus yet
        } catch (e) {
            console.error("Error handling workflow event:", e);
            // Optionally re-throw or handle the error appropriately
            // For now, let's re-throw to ensure test failures are visible
            throw e;
        }
    }

    private async handleWorkflowStart(event: WorkflowStartEvent) {
        await this.initializeSchema();
        const sql = `
            INSERT INTO workflow_run (
                workflow_name,
                status,
                error
            ) VALUES (?, ?, ?);`;

        await this.sql.exec(sql,
            event.workflowTitle,
            event.status,
            null
        );
    }

    private async handleComplete(event: WorkflowCompleteEvent) {
        const sql = `
            UPDATE workflow_run
            SET
                status = ?,
                completed_at = CURRENT_TIMESTAMP
        `;
        await this.sql.exec(sql,
            event.status
        );
    }

    private async handleWorkflowError(event: WorkflowErrorEvent) {
        const sql = `
            UPDATE workflow_run
            SET
                status = ?,
                error = ?,
                completed_at = CURRENT_TIMESTAMP
        `;
        await this.sql.exec(sql,
            event.status,
            JSON.stringify(event.error),
        );
    }

    // Add the new method definition
    private async handleStepStatus(event: StepStatusEvent) {
        const upsertSQL = `
            INSERT INTO workflow_run_steps (
                step_id,
                step_title,
                status,
                patch
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(step_id) DO UPDATE SET
                step_title = excluded.step_title,
                status = excluded.status,
                patch = excluded.patch;
        `;

        for (const step of event.steps) {
            await this.sql.exec(upsertSQL,
                step.id,
                step.title,
                step.status,
                step.patch ? JSON.stringify(step.patch) : null
            );
        }
    }
}