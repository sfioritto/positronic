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

  async dispatch(event: Event<any, SQLiteOptions>) {
    switch (event.type) {
      case WORKFLOW_EVENTS.START:
        await this.handleStart(event);
        break;
      case WORKFLOW_EVENTS.STEP_START:
        await this.handleStepStart(event);
        break;
      case WORKFLOW_EVENTS.RESTART:
        await this.handleRestart(event);
        break;
      case WORKFLOW_EVENTS.STEP_COMPLETE:
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

  private async handleStart(event: Event<any, SQLiteOptions>) {
    const { workflowTitle, status, steps } = event;

    // Wrap operations in a transaction
    this.db.transaction(() => {
      // Insert workflow run
      const result = this.db.prepare(`
        INSERT INTO workflow_runs (
          workflow_name,
          status,
          error
        ) VALUES (?, ?, ?)
      `).run(
        workflowTitle,
        status,
        null
      );

      this.workflowRunId = result.lastInsertRowid as number;

      // Create all step records upfront as pending
      steps.forEach((step, index) => {
        const sql = `
          INSERT INTO workflow_steps (
            id,
            workflow_run_id,
            title,
            state,
            status,
            error,
            step_order,
            started_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        `;

        this.db.prepare(sql).run(
          step.id,
          this.workflowRunId,
          step.title,
          JSON.stringify(step.state ?? {}),
          STATUS.PENDING,
          null,
          index
        );
      });
    })();
  }

  private async handleStepStart(event: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

    if (!event.currentStep) {
      throw new Error('Current step is required for step start event');
    }

    // Update the step to running status and set started_at
    this.db.prepare(`
      UPDATE workflow_steps SET
      status = ?,
      started_at = CURRENT_TIMESTAMP
      WHERE workflow_run_id = ? AND id = ?
    `).run(STATUS.RUNNING, this.workflowRunId, event.currentStep.id);
  }

  private async handleRestart(event: Event<any, SQLiteOptions>) {
    this.workflowRunId = event.options?.workflowRunId;

    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required to restart a workflow in the SQLite adapter');
    }

    // Wrap operations in a transaction
    this.db.transaction(() => {
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

        const previousStep = event.steps.find(step => step.id === event.currentStep?.id);
        // Re-create steps from the first non-completed step onwards
        let previousState = firstNonCompletedIndex > 0
          ? event.steps[firstNonCompletedIndex - 1].state
          : previousStep?.state;

        event.steps.slice(firstNonCompletedIndex).forEach((step, index) => {
          const sql = `
            INSERT INTO workflow_steps (
              id,
              workflow_run_id,
              title,
              state,
              status,
              error,
              step_order,
              started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
          `;

          this.db.prepare(sql).run(
            step.id,
            this.workflowRunId,
            step.title,
            JSON.stringify(step.state ?? {}),
            STATUS.PENDING,
            null,
            firstNonCompletedIndex + index
          );
        });
      }
    })();
  }

  private async handleUpdate(event: Event<any, any>) {
    if (!this.workflowRunId) {
      throw new Error('Workflow run ID is required for this event handler in the SQLite adapter');
    }

    // Wrap operations in a transaction
    this.db.transaction(async () => {
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

      if (event.currentStep) {
        // Get the current step's order by finding its index in steps array
        const currentStepOrder = event.steps.findIndex(s => s.id === event.currentStep!.id);

        // If this is the first step and it hasn't been started yet, set its started_at
        const currentStep = await this.db.prepare(`
          SELECT started_at FROM workflow_steps
          WHERE workflow_run_id = ? AND step_order = ?
        `).get(this.workflowRunId, currentStepOrder) as any;

        if (!currentStep.started_at) {
          await this.db.prepare(`
            UPDATE workflow_steps SET
            status = ?,
            started_at = CURRENT_TIMESTAMP
            WHERE workflow_run_id = ? AND step_order = ?
          `).run(STATUS.RUNNING, this.workflowRunId, currentStepOrder);
        }

        // Update completed step with the new state
        this.db.prepare(`
          UPDATE workflow_steps SET
          state = ?,
          status = ?,
          error = ?,
          completed_at = CURRENT_TIMESTAMP
          WHERE workflow_run_id = ? AND step_order = ?
        `).run(
          JSON.stringify(event.currentStep.state),
          event.currentStep.status,
          event.error ? JSON.stringify(event.error) : null,
          this.workflowRunId,
          currentStepOrder
        );

        // Start next step if it exists
        const nextStepOrder = currentStepOrder + 1;
        if (nextStepOrder < event.steps.length) {
          // Update next step's state and start it
          this.db.prepare(`
            UPDATE workflow_steps SET
            state = ?,
            status = ?,
            started_at = CURRENT_TIMESTAMP
            WHERE workflow_run_id = ? AND step_order = ?
          `).run(
            JSON.stringify(event.currentStep.state),
            STATUS.RUNNING,
            this.workflowRunId,
            nextStepOrder
          );
        }
      }
    })();
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

    // Wrap operations in a transaction
    this.db.transaction(() => {
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
      if (event.currentStep) {
        const stepOrder = event.steps.findIndex(s => s.id === event.currentStep!.id);
        if (stepOrder === -1) {
          throw new Error(`Could not find step with ID ${event.currentStep.id} in steps array`);
        }

        this.db.prepare(`
          UPDATE workflow_steps SET
          state = ?,
          status = ?,
          error = ?,
          started_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP
          WHERE workflow_run_id = ? AND step_order = ?
        `).run(
          JSON.stringify(event.currentStep.state),
          event.currentStep.status,
          serializedError ? JSON.stringify(serializedError) : null,
          this.workflowRunId,
          stepOrder
        );
      }
    })();
  }
}