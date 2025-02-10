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

    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required to restart a workflow in the SQLite adapter');
    }

    // Update workflow run status to running
    this.db.prepare(`
      UPDATE workflow_runs SET
        status = ?,
        error = NULL
      WHERE id = ?
    `).run(event.status, this.workflowRunId);

    // Delete all existing steps
    this.db.prepare(`
      DELETE FROM workflow_steps
      WHERE workflow_run_id = ?
    `).run(this.workflowRunId);

    // Re-insert initial completed steps
    const initialCompletedSteps = event.steps.filter((step) => step.status === STATUS.COMPLETE) || [];
    if (initialCompletedSteps.length > 0) {
      const insertStep = this.db.prepare(`
        INSERT INTO workflow_steps (
          workflow_run_id,
          title,
          previous_state,
          new_state,
          status,
          error
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      let previousState = event.previousState;
      for (const step of initialCompletedSteps) {
        insertStep.run(
          this.workflowRunId,
          step.title,
          JSON.stringify(previousState),
          JSON.stringify(step.state),
          step.status,
          null
        );
        previousState = step.state;
      }
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
      // Get the count of existing steps
      const stepCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM workflow_steps
        WHERE workflow_run_id = ?
      `).get(this.workflowRunId) as { count: number };

      // Get the last step's state if it exists
      const lastStep = stepCount.count > 0 ? this.db.prepare(`
        SELECT new_state FROM workflow_steps
        WHERE workflow_run_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(this.workflowRunId) as { new_state: string } : null;

      // Use the last step's state as previous state if available
      const previousState = lastStep ? lastStep.new_state : JSON.stringify(event.previousState);

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
        previousState,
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

    // Update workflow status with properly serialized error
    const serializedError = event.error ? {
      name: event.error.name,
      message: event.error.message,
      stack: event.error.stack
    } : null;

    this.db.prepare(`
      UPDATE workflow_runs SET
        status = ?,
        error = ?
      WHERE id = ?
    `).run(
      event.status,
      serializedError ? JSON.stringify(serializedError) : null,
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
        serializedError ? JSON.stringify(serializedError) : null
      );
    }
  }
}