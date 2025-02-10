import Database, { Database as DatabaseType } from "better-sqlite3";
import { jest } from "@jest/globals";
import { SQLiteAdapter } from "../src/index";
import { STATUS, WORKFLOW_EVENTS } from "@positronic/core";
import { State } from "@positronic/core";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { workflow } from "@positronic/core";
import type { PromptClient } from "@positronic/core";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

    // Read and execute init.sql file
    const initSql = readFileSync(join(__dirname, "../init.sql"), "utf8");
    db.exec(initSql);
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
    const steps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC"
    ).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(1);
    expect(JSON.parse(steps[0].previous_state)).toEqual({ count: 0 });
    expect(JSON.parse(steps[0].new_state)).toEqual({ count: 1 });
    expect(steps[0].status).toBe(STATUS.COMPLETE);
    expect(steps[0].error).toBe(null);
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
    const steps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC"
    ).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(2);

    // Verify first step
    expect(JSON.parse(steps[0].previous_state)).toEqual({ value: "test", count: 0 });
    expect(JSON.parse(steps[0].new_state)).toEqual({ value: "TEST", count: 0 });
    expect(steps[0].status).toBe(STATUS.COMPLETE);
    expect(steps[0].title).toBe("Uppercase String");

    // Verify second step
    expect(JSON.parse(steps[1].previous_state)).toEqual({ value: "TEST", count: 0 });
    expect(JSON.parse(steps[1].new_state)).toEqual({ value: "TEST", count: 1 });
    expect(steps[1].status).toBe(STATUS.COMPLETE);
    expect(steps[1].title).toBe("Increment Counter");
  });

  it("should correctly restart workflow with completed steps", async () => {
    interface MultiStepState extends State {
      value: number;
    }

    const threeStepWorkflow = workflow<{}, MultiStepState>("Three Step Workflow")
      .step("Double", async ({ state }) => ({
        value: state.value * 2
      }))
      .step("Add Ten", async ({ state }) => ({
        value: state.value + 10
      }))
      .step("Multiply By Three", async ({ state }) => ({
        value: state.value * 3
      }));

    // First, run the workflow completely
    const adapter = new SQLiteAdapter(db);
    let workflowRunId: number | undefined;

    // Run initial workflow to completion
    for await (const event of threeStepWorkflow.run({
      initialState: { value: 2 },
      client: mockClient
    })) {
      await adapter.dispatch(event);
      if (event.type === WORKFLOW_EVENTS.START) {
        const result = db.prepare(
          "SELECT id FROM workflow_runs WHERE workflow_name = ? ORDER BY id DESC LIMIT 1"
        ).get("Three Step Workflow") as any;
        workflowRunId = result.id;
      }
    }

    if (!workflowRunId) {
      throw new Error("Failed to get workflow run ID");
    }

    // Get the first two completed steps
    const completedSteps = db.prepare(
      "SELECT title, status, new_state as state FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC LIMIT 2"
    ).all(workflowRunId) as any[];

    completedSteps.forEach(step => {
      step.state = JSON.parse(step.state);
    });

    // Now restart the workflow with the first two steps
    const restartAdapter = new SQLiteAdapter(db, workflowRunId);
    for await (const event of threeStepWorkflow.run({
      initialState: { value: 2 },
      initialCompletedSteps: completedSteps,
      client: mockClient,
      options: { workflowRunId }
    })) {
      await restartAdapter.dispatch(event);
    }

    // Verify final state
    const finalSteps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY id ASC"
    ).all(workflowRunId) as any[];

    expect(finalSteps).toHaveLength(3);
    expect(JSON.parse(finalSteps[0].new_state)).toEqual({ value: 4 }); // 2 * 2
    expect(JSON.parse(finalSteps[1].new_state)).toEqual({ value: 14 }); // 4 + 10
    expect(JSON.parse(finalSteps[2].new_state)).toEqual({ value: 42 }); // 14 * 3

    const finalRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE id = ?"
    ).get(workflowRunId) as any;

    expect(finalRun.status).toBe(STATUS.COMPLETE);
    expect(finalRun.error).toBe(null);
  });
});