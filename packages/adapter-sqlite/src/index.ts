import { Database as DatabaseType } from "better-sqlite3";
import { Adapter, STATUS, WORKFLOW_EVENTS } from "@positronic/core";
import type { Event } from "@positronic/core";
import { initSQL } from './sql';

interface SQLiteOptions {
  workflowRunId?: number;
}

export class SQLiteAdapter extends Adapter<SQLiteOptions> {
  constructor(
    private db: DatabaseType,
    private workflowRunId?: number
  ) {
    super();

    // Initialize database schema
    this.db.exec(initSQL);
  }

  async dispatch(event: Event<any, any, SQLiteOptions>) {
    switch (event.type) {
      case WORKFLOW_EVENTS.START:
        await this.handleStart(event);
        break;
      case WORKFLOW_EVENTS.RESTART:
        await this.handleRestart(event);
        break;
      case WORKFLOW_EVENTS.UPDATE:
        await this.handleUpdate(event);
        break;
      case WORKFLOW_EVENTS.COMPLETE:
        await this.handleComplete(event);
        break;
      case WORKFLOW_EVENTS.ERROR:
        await this.handleError(event);
        break;
    }
  }

  private async handleStart(event: Event<any, any, SQLiteOptions>) {
    const { workflowTitle, previousState, status } = event;

    const result = this.db.prepare(`
      INSERT INTO workflow_runs (
        workflow_name,
        initial_state,
        status,
        error
      ) VALUES (?, ?, ?, ?)
    `).run(
      workflowTitle,
      JSON.stringify(previousState),
      status,
      null
    );

    this.workflowRunId = result.lastInsertRowid as number;
  }

  private async handleRestart(event: Event<any, any, SQLiteOptions>) {
    this.workflowRunId = event.options?.workflowRunId;
    const { steps = [] } = event;

    if (!this.workflowRunId) {
      await this.handleStart(event);
    } else {
      const completedSteps = steps.filter((step) => step.status === STATUS.COMPLETE);

      // Update workflow run status to running
      this.db.prepare(`
        UPDATE workflow_runs SET
          status = ?,
          error = NULL
        WHERE id = ?
      `).run(event.status, this.workflowRunId);

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

  private async handleUpdate(event: Event<any, any>) {
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

    // Only insert step record if there's a completed step
    if (event.completedStep) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          workflow_run_id,
          title,
          previous_state,
          new_state,
          status,
          error
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.workflowRunId,
        event.completedStep.title,
        JSON.stringify(event.previousState),
        JSON.stringify(event.newState),
        event.completedStep.status,
        event.error ? JSON.stringify(event.error) : null
      );
    }
  }

  private async handleComplete(event: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

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
  }

  private async handleError(event: Event<any, any>) {
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

    // Insert step error record if there's a completed step
    if (event.completedStep) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          workflow_run_id,
          title,
          previous_state,
          new_state,
          status,
          error
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.workflowRunId,
        event.completedStep.title,
        JSON.stringify(event.previousState),
        JSON.stringify(event.newState),
        event.completedStep.status,
        event.error ? JSON.stringify(event.error) : null
      );
    }
  }
}