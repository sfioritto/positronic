import { DurableObject } from 'cloudflare:workers';
import { WORKFLOW_EVENTS, STATUS } from '@positronic/core';
import type { WorkflowEvent } from '@positronic/core';

export interface Env {
  // Add any environment bindings here as needed
}

export class MonitorDO extends DurableObject<Env> {
  private readonly storage: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage.sql;

    // Create the workflow_runs table if it doesn't exist
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id TEXT PRIMARY KEY,
        workflow_title TEXT NOT NULL,
        workflow_description TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        options TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_status
      ON workflow_runs(workflow_title, status);

      CREATE INDEX IF NOT EXISTS idx_workflow_time
      ON workflow_runs(created_at DESC);
    `);
  }

  handleWorkflowEvent(event: WorkflowEvent) {
    // Only store workflow-level events
    if (event.type === WORKFLOW_EVENTS.START ||
        event.type === WORKFLOW_EVENTS.RESTART ||
        event.type === WORKFLOW_EVENTS.COMPLETE ||
        event.type === WORKFLOW_EVENTS.ERROR) {

      const currentTime = Date.now();
      const startTime = (event.type === WORKFLOW_EVENTS.START || event.type === WORKFLOW_EVENTS.RESTART) ? currentTime : null;
      const completeTime = (event.type === WORKFLOW_EVENTS.COMPLETE || event.type === WORKFLOW_EVENTS.ERROR) ? currentTime : null;
      const error = event.type === WORKFLOW_EVENTS.ERROR ? JSON.stringify(event.error) : null;

      this.storage.exec(`
        INSERT INTO workflow_runs (
          run_id, workflow_title, workflow_description, type, status,
          options, error, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          error = excluded.error,
          completed_at = excluded.completed_at
      `,
      event.workflowRunId,
      event.workflowTitle,
      event.workflowDescription || null,
      event.type,
      event.status,
      JSON.stringify(event.options || {}),
      error,
      currentTime,
      startTime,
      completeTime
      );
    }
  }

  getLastEvent(workflowRunId: string) {
    return this.storage.exec(`
      SELECT * FROM workflow_runs WHERE run_id = ?
    `, workflowRunId).one();
  }
}
