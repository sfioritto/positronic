import type {
    Adapter,
    WorkflowEvent,
    WorkflowStartEvent,
    WorkflowCompleteEvent,
    WorkflowErrorEvent,
} from '@positronic/core';
import { WORKFLOW_EVENTS } from '@positronic/core';
import type { SqlStorage } from '@cloudflare/workers-types';

// Simplified schema creation, only the workflow_runs table
const initSQL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
    workflow_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'complete', 'error')),
    error TEXT CHECK (error IS NULL OR json_valid(error)),
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
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
        if (event.type === WORKFLOW_EVENTS.START || event.type === WORKFLOW_EVENTS.RESTART) {
            await this.handleWorkflowStart(event);
        } else if (event.type === WORKFLOW_EVENTS.COMPLETE) {
            await this.handleComplete(event);
        } else if (event.type === WORKFLOW_EVENTS.ERROR) {
            await this.handleWorkflowError(event);
        }
    }

    private async handleWorkflowStart(event: WorkflowStartEvent) {
        await this.initializeSchema();
        const sql = `
            INSERT INTO workflow_runs (
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
            UPDATE workflow_runs
            SET
                status = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE workflow_name = ? AND completed_at IS NULL
        `;
        await this.sql.exec(sql,
            event.status,
            event.workflowTitle
        );
    }

    private async handleWorkflowError(event: WorkflowErrorEvent) {
        const sql = `
            UPDATE workflow_runs
            SET
                status = ?,
                error = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE workflow_name = ? AND completed_at IS NULL
        `;
        await this.sql.exec(sql,
            event.status,
            JSON.stringify({
                name: event.error.name,
                message: event.error.message,
                stack: event.error.stack
            }),
            event.workflowTitle
        );
    }
}