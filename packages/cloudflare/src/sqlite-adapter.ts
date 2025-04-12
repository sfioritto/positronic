import type {
    Adapter,
    WorkflowEvent,
    WorkflowStartEvent,
    WorkflowCompleteEvent,
    WorkflowErrorEvent,
    Workflow,
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

    private async initializeSchema(): Promise<void> {
        try {
            await this.sql.exec(initSQL);
        } catch (e: any) {
            console.error("Failed to ensure workflow_runs schema:", e.message, e.stack);
            throw new Error(`Failed to ensure workflow_runs schema: ${e.message}`);
        }
    }

    public async dispatch(event: WorkflowEvent): Promise<void> {
        if (event.type === WORKFLOW_EVENTS.START || event.type === WORKFLOW_EVENTS.RESTART) {
            await this.handleWorkflowStart(event);
        } else if (event.type === WORKFLOW_EVENTS.COMPLETE) {
            await this.handleComplete(event);
        } else if (event.type === WORKFLOW_EVENTS.ERROR) {
            await this.handleWorkflowError(event);
        }
    }

    private async handleWorkflowStart(event: WorkflowStartEvent): Promise<void> {
        console.log(JSON.stringify(event, null, 2));
        await this.initializeSchema();

        const sql = `
            INSERT INTO workflow_runs (
                workflow_name,
                status,
                error
            ) VALUES (?, ?, ?);`;

        try {
            await this.sql.exec(sql,
                event.workflowTitle,
                event.status,
                null,
            );
        } catch (e: any) {
             console.error(`Error handling workflow start/restart for ${event.workflowRunId}:`, e.message, e.stack);
             throw e;
        }
    }

    private async handleComplete(event: WorkflowCompleteEvent): Promise<void> {
        console.log('Handle the complete event', event.status);
        const sql = `
            UPDATE workflow_runs
            SET
                status = ?,
                completed_at = CURRENT_TIMESTAMP
        `;
        try {
            await this.sql.exec(sql,
                event.status,
            );
        } catch (e: any) {
            console.error(`Error handling workflow complete for ${event.workflowRunId}:`, e.message, e.stack);
            throw e;
        }
    }

    private async handleWorkflowError(event: WorkflowErrorEvent): Promise<void> {
        const sql = `
            UPDATE workflow_runs
            SET
                status = ?,
                error = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        try {
            await this.sql.exec(sql,
                event.status,
                JSON.stringify({ // Store error details as JSON
                    name: event.error.name,
                    message: event.error.message,
                    stack: event.error.stack
                }),
                event.workflowRunId
            );
        } catch (e: any) {
             console.error(`Error handling workflow error for ${event.workflowRunId}:`, e.message, e.stack);
             throw e;
        }
    }
}