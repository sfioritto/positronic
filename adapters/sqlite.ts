import { Database as DatabaseType } from "better-sqlite3";
import { Adapter } from "./adapter";
import { STATUS } from "../dsl/constants";
import type { Event, Step } from "../dsl/types";

interface SQLiteOptions {
  workflowRunId?: number;
}

class SQLiteAdapter extends Adapter<SQLiteOptions> {
  constructor(
    private db: DatabaseType,
    private workflowRunId?: number
  ) {
    super();
  }

  async restarted(event: Event<any, SQLiteOptions>) {
    this.workflowRunId = event.options?.workflowRunId;
    const { steps = [] } = event;

    if (!this.workflowRunId) {
      await this.started(event);
    } else {
      const completedSteps = steps.filter((step) => step.status === STATUS.COMPLETE);

      // Update workflow run status to running
      this.db.prepare(`
        UPDATE workflow_runs SET
          status = 'running',
          error = NULL
        WHERE id = ?
      `).run(this.workflowRunId);

      // Delete all steps after keeping the first N completed ones
      this.db.prepare(`
        DELETE FROM workflow_steps
        WHERE workflow_run_id = ?
        AND id NOT IN (
          SELECT id FROM workflow_steps
          WHERE workflow_run_id = ?
          ORDER BY id ASC
          LIMIT ?
        )
      `).run(this.workflowRunId, this.workflowRunId, completedSteps.length);
    }
  }

  async started(event: Event<any, SQLiteOptions>) {
    const { workflowName, previousState, status, error } = event;

    const result = this.db.prepare(`
      INSERT INTO workflow_runs (
        workflow_name,
        initial_state,
        status,
        error
      ) VALUES (?, ?, ?, ?)
    `).run(
      workflowName,
      JSON.stringify(previousState),
      status,
      error ? JSON.stringify(error) : null
    );

    this.workflowRunId = result.lastInsertRowid as number;
  }

  async updated(event: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

    // Update workflow status
    this.db.prepare(`
      UPDATE workflow_runs SET
        status = ?,
        error = ?
      WHERE id = ?
    `).run(
      event.status,
      event.error ? JSON.stringify(event.error) : null,
      this.workflowRunId
    );

    // Insert step completion record
    this.db.prepare(`
      INSERT INTO workflow_steps (
        workflow_run_id,
        previous_state,
        new_state,
        status,
        error
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      this.workflowRunId,
      JSON.stringify(event.previousState),
      JSON.stringify(event.newState),
      'complete',
      event.error ? JSON.stringify(event.error) : null
    );
  }

  async completed(workflow: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

    this.db.prepare(`
      UPDATE workflow_runs SET
        status = 'complete',
        error = ?
      WHERE id = ?
    `).run(
      workflow.error ? JSON.stringify(workflow.error) : null,
      this.workflowRunId
    );
  }

  async error(workflow: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

    // Update workflow status
    this.db.prepare(`
      UPDATE workflow_runs SET
        status = 'error',
        error = ?
      WHERE id = ?
    `).run(
      workflow.error ? JSON.stringify(workflow.error) : null,
      this.workflowRunId
    );

    // Insert step error record
    this.db.prepare(`
      INSERT INTO workflow_steps (
        workflow_run_id,
        previous_state,
        new_state,
        status,
        error
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      this.workflowRunId,
      JSON.stringify(workflow.previousState),
      JSON.stringify(workflow.newState),
      'error',
      workflow.error ? JSON.stringify(workflow.error) : null
    );
  }
}

export { SQLiteAdapter };

// Add type for step parameter
export function stepToRow(step: Step<any>) {
  // ... rest of file
}