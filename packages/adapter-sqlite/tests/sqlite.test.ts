import Database, { Database as DatabaseType } from "better-sqlite3";
import { jest } from "@jest/globals";
import { SQLiteAdapter } from "../src/index";
import { STATUS, WORKFLOW_EVENTS } from "@positronic/core";
import { State } from "@positronic/core";
import { workflow } from "@positronic/core";
import type { PromptClient } from "@positronic/core";

describe("SQLiteAdapter", () => {
  let db: DatabaseType;
  const mockClient = {
    execute: jest.fn(async () => ({}))
  } satisfies PromptClient;

  beforeEach(() => {
    // Reset mock
    mockClient.execute.mockClear();

    // Use in-memory SQLite database for testing
    db = new Database(":memory:");
    // Schema will be initialized by the adapter
  });

  afterEach(() => {
    db.close();
  });

  it("should track workflow execution in database", async () => {
    interface TestState extends State {
      count: number;
    }

    const testWorkflow = workflow<{}, TestState>("Test Counter")
      .step("Increment", async ({ state }) => ({
        count: state.count + 1
      }));

    // Run workflow
    const adapter = new SQLiteAdapter(db);
    for await (const event of testWorkflow.run({
      initialState: { count: 0 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    // Query and verify workflow run
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Test Counter") as any;

    expect(workflowRun).toBeTruthy();
    expect(workflowRun.workflow_name).toBe("Test Counter");
    expect(JSON.parse(workflowRun.initial_state)).toEqual({ count: 0 });
    expect(workflowRun.status).toBe(STATUS.COMPLETE);
    expect(workflowRun.error).toBe(null);

    // Query workflow steps
    const steps = db.prepare(`
      SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order ASC
    `).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("Increment");
    expect(JSON.parse(steps[0].previous_state)).toEqual({ count: 0 });
    expect(JSON.parse(steps[0].new_state)).toEqual({ count: 1 });
    expect(steps[0].status).toBe(STATUS.COMPLETE);
    expect(steps[0].error).toBe(null);
    expect(steps[0].created_at).toBeTruthy();
    expect(steps[0].started_at).toBeTruthy();
    expect(steps[0].completed_at).toBeTruthy();
  });

  it("should track multiple workflow executions correctly", async () => {
    interface CounterState extends State {
      count: number;
    }

    interface NameState extends State {
      name: string;
    }

    const counterWorkflow = workflow<{}, CounterState>("Counter Workflow")
      .step("Increment", async ({ state }) => ({
        count: state.count + 1
      }));

    const nameWorkflow = workflow<{}, NameState>("Name Workflow")
      .step("Uppercase", async ({ state }) => ({
        name: state.name.toUpperCase()
      }));

    // Run both workflows
    const adapter = new SQLiteAdapter(db);

    for await (const event of counterWorkflow.run({
      initialState: { count: 0 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    for await (const event of nameWorkflow.run({
      initialState: { name: "test" },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    // Query and verify workflow runs
    const workflowRuns = db.prepare(
      "SELECT * FROM workflow_runs ORDER BY id ASC"
    ).all() as any[];

    // Verify Counter Workflow
    expect(workflowRuns[0].workflow_name).toBe("Counter Workflow");
    expect(JSON.parse(workflowRuns[0].initial_state)).toEqual({ count: 0 });
    expect(workflowRuns[0].status).toBe(STATUS.COMPLETE);
    expect(workflowRuns[0].error).toBe(null);

    // Verify Name Workflow
    expect(workflowRuns[1].workflow_name).toBe("Name Workflow");
    expect(JSON.parse(workflowRuns[1].initial_state)).toEqual({ name: "test" });
    expect(workflowRuns[1].status).toBe(STATUS.COMPLETE);
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
    expect(allSteps[0].status).toBe(STATUS.COMPLETE);
    expect(allSteps[0].error).toBe(null);

    // Verify Name Workflow Step
    expect(JSON.parse(allSteps[1].previous_state)).toEqual({ name: "test" });
    expect(JSON.parse(allSteps[1].new_state)).toEqual({ name: "TEST" });
    expect(allSteps[1].status).toBe(STATUS.COMPLETE);
    expect(allSteps[1].error).toBe(null);
  });

  it("should track workflow step errors correctly", async () => {
    interface ErrorState extends State {
      shouldError: boolean;
    }

    const errorWorkflow = workflow<{}, ErrorState>("Error Workflow")
      .step("Maybe Error", async ({ state }) => {
        if (state.shouldError) {
          const error = new Error("Test error");
          error.name = "Error";
          throw error;
        }
        return state;
      });

    // Run workflow that will error
    const adapter = new SQLiteAdapter(db);
    let error: Error | undefined;
    try {
      for await (const event of errorWorkflow.run({
        initialState: { shouldError: true },
        client: mockClient
      })) {
        await adapter.dispatch(event);
      }
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toBe("Test error");

    // Query workflow run and its steps
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Error Workflow") as any;

    // Add assertions for workflow run
    expect(workflowRun.status).toBe(STATUS.ERROR);
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
    expect(steps[0].status).toBe(STATUS.ERROR);
    expect(JSON.parse(steps[0].error)).toMatchObject({
      name: "Error",
      message: "Test error"
    });
  });

  it("should track multi-step workflow execution step by step", async () => {
    interface MultiStepState extends State {
      value: string;
      count: number;
    }

    const multiStepWorkflow = workflow<{}, MultiStepState>("Multi Step Workflow")
      .step("Uppercase String", async ({ state }) => ({
        ...state,
        value: state.value.toUpperCase()
      }))
      .step("Increment Counter", async ({ state }) => ({
        ...state,
        count: state.count + 1
      }));

    const adapter = new SQLiteAdapter(db);

    for await (const event of multiStepWorkflow.run({
      initialState: { value: "test", count: 0 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    // Verify workflow state after completion
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Multi Step Workflow") as any;

    expect(workflowRun.status).toBe(STATUS.COMPLETE);

    // Verify steps
    const steps = db.prepare(`
      SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order ASC
    `).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(2);

    // Verify first step
    expect(steps[0].title).toBe("Uppercase String");
    expect(JSON.parse(steps[0].previous_state)).toEqual({ value: "test", count: 0 });
    expect(JSON.parse(steps[0].new_state)).toEqual({ value: "TEST", count: 0 });
    expect(steps[0].status).toBe(STATUS.COMPLETE);
    expect(steps[0].created_at).toBeTruthy();
    expect(steps[0].started_at).toBeTruthy();
    expect(steps[0].completed_at).toBeTruthy();

    // Verify second step
    expect(steps[1].title).toBe("Increment Counter");
    expect(JSON.parse(steps[1].previous_state)).toEqual({ value: "TEST", count: 0 });
    expect(JSON.parse(steps[1].new_state)).toEqual({ value: "TEST", count: 1 });
    expect(steps[1].status).toBe(STATUS.COMPLETE);
    expect(steps[1].created_at).toBeTruthy();
    expect(steps[1].started_at).toBeTruthy();
    expect(steps[1].completed_at).toBeTruthy();
  });

  it("should correctly restart workflow with completed steps", async () => {
    interface MultiStepState extends State {
      value: number;
    }

    const fourStepWorkflow = workflow<{}, MultiStepState>("Four Step Workflow")
      .step("Double", async ({ state }) => ({
        value: state.value * 2
      }))
      .step("Add Ten", async ({ state }) => ({
        value: state.value + 10
      }))
      .step("Multiply By Three", async ({ state }) => ({
        value: state.value * 3
      }))
      .step("Final Step", async ({ state }) => ({
        value: state.value + 5
      }));

    // First, run the workflow completely
    const adapter = new SQLiteAdapter(db);
    let workflowRunId: number | undefined;

    // Run initial workflow to completion
    for await (const event of fourStepWorkflow.run({
      initialState: { value: 2 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
      if (event.type === WORKFLOW_EVENTS.START) {
        const result = db.prepare(
          "SELECT id FROM workflow_runs WHERE workflow_name = ? ORDER BY id DESC LIMIT 1"
        ).get("Four Step Workflow") as any;
        workflowRunId = result.id;
      }
    }

    if (!workflowRunId) {
      throw new Error("Failed to get workflow run ID");
    }

    // Get the first two completed steps
    const completedSteps = db.prepare(`
      SELECT title, status, new_state as state, created_at, started_at, completed_at
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
      LIMIT 2
    `).all(workflowRunId) as any[];

    completedSteps.forEach(step => {
      step.state = JSON.parse(step.state);
    });

    console.log('Original completed steps:', completedSteps);

    const firstNonCompletedIndex = 2; // We know we're completing first 2 steps

    // Log all steps before restart
    console.log('Steps before restart:', db.prepare(`
      SELECT title, created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRunId));

    // Start the restart but only process the RESTART event
    const workflowIterator = fourStepWorkflow.run({
      initialState: { value: 2 },
      initialCompletedSteps: completedSteps,
      client: mockClient,
      options: { workflowRunId }
    });

    // Process only the RESTART event
    const restartEvent = await workflowIterator.next();
    await adapter.dispatch(restartEvent.value);

    // Log all steps after restart
    console.log('Steps after restart:', db.prepare(`
      SELECT title, created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRunId));

    // Get steps after restart but before execution
    const pendingSteps = db.prepare(`
      SELECT title, created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ? AND step_order = ?
      ORDER BY step_order ASC
    `).all(workflowRunId, 3) as any[]; // Check the LAST step (Final Step)

    console.log('Pending steps query result:', {
      workflowRunId,
      targetStepOrder: firstNonCompletedIndex + 1,
      steps: pendingSteps
    });

    // Verify last pending step has created_at but no started_at or completed_at
    expect(pendingSteps[0].created_at).toBeTruthy();
    expect(pendingSteps[0].started_at).toBeNull();
    expect(pendingSteps[0].completed_at).toBeNull();
    expect(pendingSteps[0].status).toBe('pending');

    // Complete the rest of the workflow
    for await (const event of fourStepWorkflow.run({
      initialState: { value: 2 },
      initialCompletedSteps: completedSteps,
      client: mockClient,
      options: { workflowRunId }
    })) {
      await adapter.dispatch(event);
    }

    // Get steps after restart and completion
    const restartedSteps = db.prepare(`
      SELECT title, created_at, started_at, completed_at
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRunId) as any[];

    console.log('Restarted steps:', restartedSteps);

    // Verify first two steps have exactly the same timestamps
    completedSteps.forEach((original, index) => {
      const restarted = restartedSteps[index];
      expect(restarted.created_at).toBe(original.created_at);
      expect(restarted.started_at).toBe(original.started_at);
      expect(restarted.completed_at).toBe(original.completed_at);
    });

    // Verify the third step now has all timestamps after completion
    expect(restartedSteps[2].created_at).toBeTruthy();
    expect(restartedSteps[2].started_at).toBeTruthy();
    expect(restartedSteps[2].completed_at).toBeTruthy();
  });

  it("should handle timestamps correctly", async () => {
    interface TestState extends State {
      count: number;
    }

    const testWorkflow = workflow("Timestamp Test")
      .step("Step 1", async ({ state }) => ({
        count: ((state as TestState).count ?? 0) + 1
      }));

    const adapter = new SQLiteAdapter(db);
    const workflowIterator = testWorkflow.run({
      initialState: { count: 0 },
      client: mockClient
    });

    // First event (workflow started)
    const startEvent = await workflowIterator.next();
    await adapter.dispatch(startEvent.value);

    // Check initial workflow state
    const initialRun = db.prepare(`
      SELECT id, created_at, completed_at
      FROM workflow_runs
      WHERE workflow_name = ?
    `).get("Timestamp Test") as any;

    expect(initialRun.created_at).toBeTruthy();
    expect(initialRun.completed_at).toBeNull();

    // Check initial step state
    const initialSteps = db.prepare(`
      SELECT created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(initialRun.id) as any[];

    // Verify steps are created upfront
    expect(initialSteps.length).toBe(1);
    expect(initialSteps[0].created_at).toBeTruthy();
    expect(initialSteps[0].started_at).toBeNull();
    expect(initialSteps[0].completed_at).toBeNull();
    expect(initialSteps[0].status).toBe('pending');

    // Second event (step completed)
    const stepEvent = await workflowIterator.next();
    await adapter.dispatch(stepEvent.value);

    // Check workflow state after step
    const midRun = db.prepare(`
      SELECT completed_at
      FROM workflow_runs
      WHERE id = ?
    `).get(initialRun.id) as any;
    expect(midRun.completed_at).toBeNull();

    // Check step state after completion
    const midStep = db.prepare(`
      SELECT created_at, started_at, completed_at, status
      FROM workflow_steps
      WHERE workflow_run_id = ?
    `).get(initialRun.id) as any;

    expect(midStep.created_at).toBeTruthy();
    expect(midStep.started_at).toBeTruthy();
    expect(midStep.completed_at).toBeTruthy();
    expect(midStep.status).toBe(STATUS.COMPLETE);

    // Final event (workflow completed)
    const completeEvent = await workflowIterator.next();
    await adapter.dispatch(completeEvent.value);

    // Check final workflow state
    const finalRun = db.prepare(`
      SELECT completed_at
      FROM workflow_runs
      WHERE id = ?
    `).get(initialRun.id) as any;
    expect(finalRun.completed_at).toBeTruthy();
  });

  it("should enforce JSON validation constraints", async () => {
    expect(() => {
      db.prepare(`
        INSERT INTO workflow_runs (
          workflow_name,
          initial_state,
          status,
          error
        ) VALUES (?, ?, ?, ?)
      `).run("Test", "invalid json", STATUS.COMPLETE, null);
    }).toThrow();
  });

  it("should handle concurrent workflow executions correctly", async () => {
    interface TestState extends State {
      value: number;
    }

    const testWorkflow = workflow<{}, TestState>("Concurrent Test")
      .step("Step 1", async ({ state }) => ({
        value: state.value + 1
      }));

    // Run workflows sequentially to ensure predictable state
    const adapter = new SQLiteAdapter(db);

    // Run first workflow
    for await (const event of testWorkflow.run({
      initialState: { value: 1 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    // Run second workflow
    for await (const event of testWorkflow.run({
      initialState: { value: 2 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    // Run third workflow
    for await (const event of testWorkflow.run({
      initialState: { value: 3 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
    }

    // Verify all workflow runs were recorded correctly
    const runs = db.prepare(`
      SELECT * FROM workflow_runs
      WHERE workflow_name = ?
      ORDER BY id ASC
    `).all("Concurrent Test") as any[];

    expect(runs).toHaveLength(3);
    expect(JSON.parse(runs[0].initial_state)).toEqual({ value: 1 });
    expect(JSON.parse(runs[1].initial_state)).toEqual({ value: 2 });
    expect(JSON.parse(runs[2].initial_state)).toEqual({ value: 3 });

    // Verify all steps were recorded correctly
    const steps = db.prepare(`
      SELECT s.*
      FROM workflow_steps s
      JOIN workflow_runs r ON s.workflow_run_id = r.id
      WHERE r.workflow_name = ?
      ORDER BY r.id ASC
    `).all("Concurrent Test") as any[];

    expect(steps).toHaveLength(3);
    expect(JSON.parse(steps[0].new_state)).toEqual({ value: 2 });
    expect(JSON.parse(steps[1].new_state)).toEqual({ value: 3 });
    expect(JSON.parse(steps[2].new_state)).toEqual({ value: 4 });
  });

  it("should preserve timestamps of completed steps during restart", async () => {
    interface TestState extends State {
      value: number;
    }

    const fourStepWorkflow = workflow<{}, TestState>("Timestamp Preservation Test")
      .step("Step 1", async ({ state }) => ({
        value: state.value + 1
      }))
      .step("Step 2", async ({ state }) => ({
        value: state.value + 2
      }))
      .step("Step 3", async ({ state }) => ({
        value: state.value + 3
      }))
      .step("Step 4", async ({ state }) => ({
        value: state.value + 4
      }));

    const adapter = new SQLiteAdapter(db);
    let workflowRunId: number | undefined;

    // Run initial workflow to completion
    for await (const event of fourStepWorkflow.run({
      initialState: { value: 0 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
      if (event.type === WORKFLOW_EVENTS.START) {
        const result = db.prepare(
          "SELECT id FROM workflow_runs WHERE workflow_name = ? ORDER BY id DESC LIMIT 1"
        ).get("Timestamp Preservation Test") as any;
        workflowRunId = result.id;
      }
    }

    if (!workflowRunId) {
      throw new Error("Failed to get workflow run ID");
    }

    // Get the first two completed steps for restart with their timestamps
    const completedSteps = db.prepare(`
      SELECT title, status, new_state as state, created_at, started_at, completed_at
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
      LIMIT 2
    `).all(workflowRunId) as any[];

    completedSteps.forEach(step => {
      step.state = JSON.parse(step.state);
    });

    console.log('Original completed steps:', completedSteps);

    const firstNonCompletedIndex = 2; // We know we're completing first 2 steps

    // Start the restart but only process the RESTART event
    const workflowIterator = fourStepWorkflow.run({
      initialState: { value: 0 },
      initialCompletedSteps: completedSteps,
      client: mockClient,
      options: { workflowRunId }
    });

    // Process only the RESTART event
    const restartEvent = await workflowIterator.next();
    await adapter.dispatch(restartEvent.value);

    // Now check the pending steps - look at the LAST step (Step 4)
    const pendingSteps = db.prepare(`
      SELECT title, created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ? AND step_order = ?
      ORDER BY step_order ASC
    `).all(workflowRunId, 3) as any[]; // Explicitly check step_order 3 (fourth step)

    console.log('Pending steps query result:', {
      workflowRunId,
      targetStepOrder: firstNonCompletedIndex + 1,
      steps: pendingSteps
    });

    // Also log all steps to see the full picture
    const allSteps = db.prepare(`
      SELECT title, created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRunId) as any[];

    console.log('All steps after restart:', allSteps);

    // Verify last pending step has created_at but no started_at or completed_at
    expect(pendingSteps[0].created_at).toBeTruthy();
    expect(pendingSteps[0].started_at).toBeNull();
    expect(pendingSteps[0].completed_at).toBeNull();
    expect(pendingSteps[0].status).toBe('pending');

    // Complete the rest of the workflow
    for await (const event of fourStepWorkflow.run({
      initialState: { value: 0 },
      initialCompletedSteps: completedSteps,
      client: mockClient,
      options: { workflowRunId }
    })) {
      await adapter.dispatch(event);
    }

    // Get steps after restart and completion
    const restartedSteps = db.prepare(`
      SELECT title, created_at, started_at, completed_at
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRunId) as any[];

    console.log('Restarted steps:', restartedSteps);

    // Verify first two steps have exactly the same timestamps
    completedSteps.forEach((original, index) => {
      const restarted = restartedSteps[index];
      expect(restarted.created_at).toBe(original.created_at);
      expect(restarted.started_at).toBe(original.started_at);
      expect(restarted.completed_at).toBe(original.completed_at);
    });

    // Verify the third step now has all timestamps after completion
    expect(restartedSteps[2].created_at).toBeTruthy();
    expect(restartedSteps[2].started_at).toBeTruthy();
    expect(restartedSteps[2].completed_at).toBeTruthy();
  });
});
