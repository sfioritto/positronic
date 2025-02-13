import { Database as DatabaseType } from "better-sqlite3";
import { Adapter, WORKFLOW_EVENTS } from "@positronic/core";
import type {
  WorkflowEvent,
  WorkflowStartEvent,
  WorkflowCompleteEvent,
  WorkflowErrorEvent,
  StepStatusEvent,
  StepStartedEvent,
} from "@positronic/core";
import { initSQL } from './sql';

interface SQLiteOptions {
  workflowRunId?: number;
}

export class SQLiteAdapter extends Adapter<SQLiteOptions> {
  constructor(private db: DatabaseType) {
    super();
    // Initialize database schema
    this.db.exec(initSQL);
  }

  public async dispatch(event: WorkflowEvent<SQLiteOptions>) {
    console.log('Dispatching event:', event.type);

    switch (event.type) {
      case WORKFLOW_EVENTS.START:
        this.handleWorkflowStart(event);
        break;
      case WORKFLOW_EVENTS.STEP_START:
        console.log('Handling step start:', event.stepId);
        this.handleStepStart(event);
        // Verify the update
        const startedStep = this.db.prepare(
          "SELECT started_at FROM workflow_steps WHERE id = ?"
        ).get(event.stepId);
        console.log('After step start update:', startedStep);
        break;
      case WORKFLOW_EVENTS.STEP_STATUS:
        console.log('Handling step status:',
          event.steps.map(s => ({ id: s.id, status: s.status })));
        this.handleStepStatus(event);
        break;
      case WORKFLOW_EVENTS.COMPLETE:
        this.handleComplete(event);
        break;
      case WORKFLOW_EVENTS.ERROR:
        this.handleWorkflowError(event);
        break;
    }
  }

  private async handleWorkflowStart(event: WorkflowStartEvent<SQLiteOptions>) {
    // Insert or update workflow run
    this.db.prepare(`
      INSERT INTO workflow_runs (
        id,
        workflow_name,
        status,
        error
      ) VALUES (?, ?, ?, ?)
    `).run(
      event.workflowRunId,
      event.workflowTitle,
      event.status,
      null
    );
  }

  private handleStepStart(event: StepStartedEvent<SQLiteOptions>) {
    console.log('Running step start SQL update for step:', event.stepId);
    this.db.prepare(`
      UPDATE workflow_steps
      SET
        status = 'running',
        started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(event.stepId);
  }

  private async handleStepStatus(event: StepStatusEvent<SQLiteOptions>) {
    console.log('Running step status SQL update for steps:',
      event.steps.map(s => ({ id: s.id, status: s.status })));
    // Wrap operations in a transaction
    this.db.transaction(() => {
      // Upsert all steps
      event.steps.forEach((step, index) => {
        this.db.prepare(`
          INSERT INTO workflow_steps (
            id,
            workflow_run_id,
            title,
            status,
            patch,
            step_order,
            started_at,
            completed_at
          ) VALUES (?, ?, ?, ?, ?, ?,
            CASE WHEN ? = 'running' THEN CURRENT_TIMESTAMP ELSE NULL END,
            CASE WHEN ? IN ('complete', 'error') THEN CURRENT_TIMESTAMP ELSE NULL END
          )
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            patch = excluded.patch,
            step_order = excluded.step_order,
            started_at = CASE
              WHEN excluded.status = 'running' AND started_at IS NULL
              THEN CURRENT_TIMESTAMP
              ELSE started_at
            END,
            completed_at = CASE
              WHEN excluded.status IN ('complete', 'error') AND completed_at IS NULL
              THEN CURRENT_TIMESTAMP
              ELSE completed_at
            END
        `).run(
          step.id,
          event.workflowRunId,
          step.title,
          step.status,
          step.patch ? JSON.stringify(step.patch) : null,
          index,
          step.status,  // For started_at CASE
          step.status   // For completed_at CASE
        );
      });
    })();
  }

  private async handleComplete(event: WorkflowCompleteEvent<SQLiteOptions>) {
    this.db.prepare(`
      UPDATE workflow_runs
      SET
        status = ?,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      event.status,
      event.workflowRunId
    );
  }

  private handleWorkflowError(event: WorkflowErrorEvent<SQLiteOptions>) {
    this.db.prepare(`
      UPDATE workflow_runs
      SET
        status = ?,
        error = ?,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      event.status,
      JSON.stringify({
        name: event.error.name,
        message: event.error.message,
        stack: event.error.stack
      }),
      event.workflowRunId
    );
  }
}