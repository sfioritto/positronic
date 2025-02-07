import Database, { Database as DatabaseType } from "better-sqlite3";
import { SQLiteAdapter } from "./index";
import { STATUS } from "../../positronic/src/dsl/constants";
import { workflow } from "../../positronic/src/dsl/workflow";
import { readFileSync } from "fs";
import { join } from "path";
import { runWorkflow, runWorkflowStepByStep } from "./test-helpers";

describe("SQLiteAdapter", () => {
  let db: DatabaseType;

  beforeEach(() => {
    // Use in-memory SQLite database for testing
    db = new Database(":memory:");

    // Read and execute init.sql file
    const initSql = readFileSync(join(__dirname, "../init.sql"), "utf8");
    db.exec(initSql);
  });

  afterEach(() => {
    db.close();
  });

  it("should track workflow execution in database", async () => {
    interface TestState {
      count: number;
    }

    const testWorkflow = workflow<TestState>(
      "Test Counter",
      step(
        "Increment",
        action(async (state) => state.count + 1),
        reduce((result) => ({ count: result }))
      )
    );

    // Run workflow
    await runWorkflow(testWorkflow, { count: 0 }, [new SQLiteAdapter(db)]);

    // Query and verify workflow run
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Test Counter") as any;

    expect(workflowRun).toBeTruthy();
    expect(workflowRun.workflow_name).toBe("Test Counter");
    expect(JSON.parse(workflowRun.initial_state)).toEqual({ count: 0 });
    expect(workflowRun.status).toBe("complete");
    expect(workflowRun.error).toBe(null);

    // Query workflow steps
    const steps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY created_at ASC"
    ).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(1);
    expect(JSON.parse(steps[0].previous_state)).toEqual({ count: 0 });
    expect(JSON.parse(steps[0].new_state)).toEqual({ count: 1 });
    expect(steps[0].status).toBe("complete");
    expect(steps[0].error).toBe(null);
  });

  it("should track multiple workflow executions correctly", async () => {
    interface CounterState {
      count: number;
    }

    interface NameState {
      name: string;
    }

    const counterWorkflow = workflow<CounterState>(
      "Counter Workflow",
      step(
        "Increment",
        action(async (state) => state.count + 1),
        reduce((result) => ({ count: result }))
      )
    );

    const nameWorkflow = workflow<NameState>(
      "Name Workflow",
      step(
        "Uppercase",
        action(async (state) => state.name.toUpperCase()),
        reduce((result) => ({ name: result }))
      )
    );

    // Run both workflows
    await runWorkflow(counterWorkflow, { count: 0 }, [new SQLiteAdapter(db)]);
    await runWorkflow(nameWorkflow, { name: "test" }, [new SQLiteAdapter(db)]);

    // Query and verify workflow runs
    const workflowRuns = db.prepare(
      "SELECT * FROM workflow_runs ORDER BY created_at ASC"
    ).all() as any[];

    // Verify Counter Workflow
    expect(workflowRuns[0].workflow_name).toBe("Counter Workflow");
    expect(JSON.parse(workflowRuns[0].initial_state)).toEqual({ count: 0 });
    expect(workflowRuns[0].status).toBe("complete");
    expect(workflowRuns[0].error).toBe(null);

    // Verify Name Workflow
    expect(workflowRuns[1].workflow_name).toBe("Name Workflow");
    expect(JSON.parse(workflowRuns[1].initial_state)).toEqual({ name: "test" });
    expect(workflowRuns[1].status).toBe("complete");
    expect(workflowRuns[1].error).toBe(null);

    // Query workflow steps for both workflows
    const allSteps = db.prepare(`
      SELECT s.*
      FROM workflow_steps s
      JOIN workflow_runs r ON s.workflow_run_id = r.id
      ORDER BY r.id, s.id ASC
    `).all() as any[];

    expect(allSteps).toHaveLength(2);

    // Verify Counter Workflow Step
    expect(JSON.parse(allSteps[0].previous_state)).toEqual({ count: 0 });
    expect(JSON.parse(allSteps[0].new_state)).toEqual({ count: 1 });
    expect(allSteps[0].status).toBe("complete");
    expect(allSteps[0].error).toBe(null);

    // Verify Name Workflow Step
    expect(JSON.parse(allSteps[1].previous_state)).toEqual({ name: "test" });
    expect(JSON.parse(allSteps[1].new_state)).toEqual({ name: "TEST" });
    expect(allSteps[1].status).toBe("complete");
    expect(allSteps[1].error).toBe(null);
  });

  it("should track workflow step errors correctly", async () => {
    interface ErrorState {
      shouldError: boolean;
    }

    const errorWorkflow = workflow<ErrorState>(
      "Error Workflow",
      step(
        "Maybe Error",
        action(async (state) => {
          if (state.shouldError) {
            throw new Error("Test error");
          }
          return state;
        })
      )
    );

    // Run workflow that will error
    await runWorkflow(errorWorkflow, { shouldError: true }, [new SQLiteAdapter(db)]);

    // Query workflow run and its steps
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Error Workflow") as any;

    // Add assertions for workflow run
    expect(workflowRun.status).toBe("error");
    expect(JSON.parse(workflowRun.error)).toMatchObject({
      name: "Error",
      message: "Test error"
    });

    const steps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ?"
    ).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(1);
    expect(JSON.parse(steps[0].previous_state)).toEqual({ shouldError: true });
    expect(JSON.parse(steps[0].new_state)).toEqual({ shouldError: true });
    expect(steps[0].status).toBe("error");
    expect(JSON.parse(steps[0].error)).toMatchObject({
      name: "Error",
      message: "Test error"
    });
  });

  it("should track multi-step workflow execution step by step", async () => {
    interface MultiStepState {
      value: string;
      count: number;
    }

    const multiStepWorkflow = workflow<MultiStepState>(
      "Multi Step Workflow",
      step(
        "Uppercase String",
        action(async (state) => state.value.toUpperCase()),
        reduce((result, state) => ({ ...state, value: result }))
      ),
      step(
        "Increment Counter",
        action(async (state) => state.count + 1),
        reduce((result, state) => ({ ...state, count: result }))
      )
    );

    const adapter = new SQLiteAdapter(db);
    const stepIterator = runWorkflowStepByStep(
      multiStepWorkflow,
      { value: "test", count: 0 },
      [adapter]
    );

    // Run first step
    await stepIterator.next(); // START event
    await stepIterator.next(); // UPDATE event

    // Verify workflow state after first step
    const firstStepRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Multi Step Workflow") as any;

    expect(firstStepRun.status).toBe("running");

    const latestStep = db.prepare(`
      SELECT * FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(firstStepRun.id) as any;

    expect(JSON.parse(latestStep.new_state)).toEqual({ value: "TEST", count: 0 });

    // Verify first step row
    const firstStepRows = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY created_at ASC"
    ).all(firstStepRun.id) as any[];

    expect(firstStepRows).toHaveLength(1);
    expect(JSON.parse(firstStepRows[0].previous_state)).toEqual({ value: "test", count: 0 });
    expect(JSON.parse(firstStepRows[0].new_state)).toEqual({ value: "TEST", count: 0 });
    expect(firstStepRows[0].status).toBe("complete");

    // Run second step
    await stepIterator.next(); // UPDATE event

    // Verify steps after second step completes
    const secondStepRows = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY created_at ASC"
    ).all(firstStepRun.id) as any[];

    expect(secondStepRows).toHaveLength(2);
    expect(JSON.parse(secondStepRows[1].previous_state)).toEqual({ value: "TEST", count: 0 });
    expect(JSON.parse(secondStepRows[1].new_state)).toEqual({ value: "TEST", count: 1 });
    expect(secondStepRows[1].status).toBe("complete");

    // Complete workflow
    await stepIterator.next(); // COMPLETE event

    // Verify final state
    const finalRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Multi Step Workflow") as any;

    expect(finalRun.status).toBe("complete");

    const finalStep = db.prepare(`
      SELECT * FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(finalRun.id) as any;

    expect(JSON.parse(finalStep.new_state)).toEqual({ value: "TEST", count: 1 });
  });

  it("should correctly restart workflow with completed steps", async () => {
    interface MultiStepState {
      value: number;
    }

    const threeStepWorkflow = workflow<MultiStepState>(
      "Three Step Workflow",
      step(
        "Double",
        action(async (state) => state.value * 2),
        reduce((result) => ({ value: result }))
      ),
      step(
        "Add Ten",
        action(async (state) => state.value + 10),
        reduce((result) => ({ value: result }))
      ),
      step(
        "Multiply By Three",
        action(async (state) => state.value * 3),
        reduce((result) => ({ value: result }))
      )
    );

    // First, run the workflow completely
    const adapter = new SQLiteAdapter(db);
    await runWorkflow(threeStepWorkflow, { value: 2 }, [adapter]);

    // Get the workflow run ID and first two completed steps
    const initialRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Three Step Workflow") as any;

    const completedSteps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC LIMIT 2"
    ).all(initialRun.id) as any[];

    // Now restart the workflow with the first two steps
    const restartAdapter = new SQLiteAdapter(db);
    const stepIterator = runWorkflowStepByStep(
      threeStepWorkflow,
      { value: 2 },
      [restartAdapter],
      completedSteps.map(step => ({
        title: step.title,
        state: JSON.parse(step.new_state),
        status: STATUS.COMPLETE,
      })),
      { workflowRunId: initialRun.id }
    );

    // Run first step (should be a restart)
    await stepIterator.next(); // RESTART event

    // Verify that only two steps exist in database
    const afterRestartSteps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC"
    ).all(initialRun.id) as any[];

    expect(afterRestartSteps).toHaveLength(2);
    expect(JSON.parse(afterRestartSteps[0].new_state)).toEqual({ value: 4 }); // 2 * 2
    expect(JSON.parse(afterRestartSteps[1].new_state)).toEqual({ value: 14 }); // 4 + 10

    // Complete the workflow
    await stepIterator.next(); // Final step
    await stepIterator.next(); // COMPLETE event

    // Verify final state
    const finalSteps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC"
    ).all(initialRun.id) as any[];

    expect(finalSteps).toHaveLength(3);
    expect(JSON.parse(finalSteps[0].new_state)).toEqual({ value: 4 }); // 2 * 2
    expect(JSON.parse(finalSteps[1].new_state)).toEqual({ value: 14 }); // 4 + 10
    expect(JSON.parse(finalSteps[2].new_state)).toEqual({ value: 42 }); // 14 * 3

    const finalRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE id = ?"
    ).get(initialRun.id) as any;

    expect(finalRun.status).toBe("complete");
    expect(finalRun.error).toBe(null);
  });
});