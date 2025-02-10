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
    const { workflowTitle, previousState, status, steps } = event;

    // Insert workflow run
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

    // Create all step records upfront as pending
    steps.forEach((step, index) => {
      const sql = `
        INSERT INTO workflow_steps (
          workflow_run_id,
          title,
          previous_state,
          new_state,
          status,
          error,
          step_order,
          started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `;

      this.db.prepare(sql).run(
        this.workflowRunId,
        step.title,
        JSON.stringify(previousState),
        JSON.stringify(previousState),
        'pending',
        null,
        index
      );
    });
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

    // Find the index of the first non-completed step from the event
    const firstNonCompletedIndex = event.steps.findIndex(step => step.status !== STATUS.COMPLETE);

    // Delete steps from this index onwards
    if (firstNonCompletedIndex !== -1) {

      this.db.prepare(`
        DELETE FROM workflow_steps
        WHERE workflow_run_id = ? AND step_order >= ?
      `).run(this.workflowRunId, firstNonCompletedIndex);

      // Re-create steps from the first non-completed step onwards
      let previousState = firstNonCompletedIndex > 0
        ? event.steps[firstNonCompletedIndex - 1].state
        : event.previousState;

      event.steps.slice(firstNonCompletedIndex).forEach((step, index) => {

        const sql = `
          INSERT INTO workflow_steps (
            workflow_run_id,
            title,
            previous_state,
            new_state,
            status,
            error,
            step_order,
            created_at,
            started_at,
            completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, NULL)
        `;

        this.db.prepare(sql).run(
          this.workflowRunId,
          step.title,
          JSON.stringify(previousState),
          JSON.stringify(previousState),
          'pending',
          null,
          firstNonCompletedIndex + index
        );
      });

      // Start the next pending step

      this.db.prepare(`
        UPDATE workflow_steps SET
        status = 'running',
        started_at = CURRENT_TIMESTAMP
        WHERE workflow_run_id = ? AND step_order = ?
      `).run(this.workflowRunId, firstNonCompletedIndex);
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

    if (event.completedStep) {
      // Get the current step's order by finding its index in steps array
      const currentStepOrder = event.steps.findIndex(s => s.id === event.completedStep!.id);

      // If this is the first step and it hasn't been started yet, set its started_at
      const currentStep = await this.db.prepare(`
        SELECT started_at FROM workflow_steps
        WHERE workflow_run_id = ? AND step_order = ?
      `).get(this.workflowRunId, currentStepOrder) as any;

      if (!currentStep.started_at) {
        await this.db.prepare(`
          UPDATE workflow_steps SET
          status = 'running',
          started_at = CURRENT_TIMESTAMP
          WHERE workflow_run_id = ? AND step_order = ?
        `).run(this.workflowRunId, currentStepOrder);
      }

      // Update completed step with the new state
      this.db.prepare(`
        UPDATE workflow_steps SET
        new_state = ?,
        status = ?,
        error = ?,
        completed_at = CURRENT_TIMESTAMP
        WHERE workflow_run_id = ? AND step_order = ?
      `).run(
        JSON.stringify(event.completedStep.state),
        event.completedStep.status,
        event.error ? JSON.stringify(event.error) : null,
        this.workflowRunId,
        currentStepOrder
      );

      // Start next step if it exists
      const nextStepOrder = currentStepOrder + 1;
      if (nextStepOrder < event.steps.length) {
        // Update next step's previous state and start it
        this.db.prepare(`
          UPDATE workflow_steps SET
          previous_state = ?,
          new_state = ?,
          status = 'running',
          started_at = CURRENT_TIMESTAMP
          WHERE workflow_run_id = ? AND step_order = ?
        `).run(
          JSON.stringify(event.completedStep.state),
          JSON.stringify(event.completedStep.state),
          this.workflowRunId,
          nextStepOrder
        );
      }
    }
  }

  private async handleComplete(event: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

    this.db.prepare(`
      UPDATE workflow_runs SET
        status = ?,
        error = ?,
        completed_at = CURRENT_TIMESTAMP
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

    const serializedError = event.error ? {
      name: event.error.name,
      message: event.error.message,
      stack: event.error.stack
    } : null;

    // Update workflow status
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

    // Update the errored step
    if (event.completedStep) {
      const stepOrder = event.steps.findIndex(s => s.title === event.completedStep!.title);
      this.db.prepare(`
        UPDATE workflow_steps SET
        new_state = ?,
        status = ?,
        error = ?,
        started_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP
        WHERE workflow_run_id = ? AND step_order = ?
      `).run(
        JSON.stringify(event.newState),
        event.completedStep.status,
        serializedError ? JSON.stringify(serializedError) : null,
        this.workflowRunId,
        stepOrder
      );
    }
  }
}