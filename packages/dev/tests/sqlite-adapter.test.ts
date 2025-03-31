import Database, { Database as DatabaseType } from "better-sqlite3";
import { jest } from "@jest/globals";
import { SQLiteAdapter } from "../src/sqlite-adapter";
import { STATUS, WORKFLOW_EVENTS, applyPatches, workflow, State } from "@positronic/core";
import { LocalShell } from "../src/local-shell";
import { nextStep } from "../../../test-utils";
import type {
  PromptClient, SerializedStep, StepStatusEvent, WorkflowStartEvent
} from "@positronic/core";
import { ResourceLoader } from "@positronic/interfaces";

class TestResourceLoader implements ResourceLoader {
  load: ResourceLoader['load'] = jest.fn().mockImplementation(async () => 'content') as ResourceLoader['load'];
}

describe("SQLiteAdapter", () => {
  let db: DatabaseType;
  const mockClient = {
    execute: jest.fn(async () => ({}))
  } satisfies PromptClient;

  // Initialize once to use in all tests
  const mockShell = new LocalShell();

  // Create test services
  const testServices = {
    resources: new TestResourceLoader()
  };

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
      client: mockClient,
    })) {
      await adapter.dispatch(event);
    }

    // Query and verify workflow run
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Test Counter") as any;

    expect(workflowRun).toBeTruthy();
    expect(workflowRun.workflow_name).toBe("Test Counter");
    expect(workflowRun.status).toBe(STATUS.COMPLETE);
    expect(workflowRun.error).toBe(null);
    expect(workflowRun.created_at).toBeTruthy();
    expect(workflowRun.completed_at).toBeTruthy();

    // Query workflow steps
    const steps = db.prepare(`
      SELECT * FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(1);
    expect(typeof steps[0].id).toBe('string'); // Verify ID is a string
    expect(steps[0].title).toBe("Increment");
    expect(JSON.parse(steps[0].patch)).toEqual([
      { op: "replace", path: "/count", value: 1 }
    ]); // JSON Patch format
    expect(steps[0].status).toBe(STATUS.COMPLETE);
    expect(steps[0].created_at).toBeTruthy();
    expect(steps[0].started_at).toBeTruthy();
    expect(steps[0].completed_at).toBeTruthy();
    expect(steps[0].step_order).toBe(0);
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
      client: mockClient,
    })) {
      await adapter.dispatch(event);
    }

    for await (const event of nameWorkflow.run({
      initialState: { name: "test" },
      client: mockClient,
    })) {
      await adapter.dispatch(event);
    }

    // Query and verify workflow runs
    const workflowRuns = db.prepare(
      "SELECT * FROM workflow_runs ORDER BY created_at ASC"
    ).all() as any[];

    expect(workflowRuns).toHaveLength(2);

    // Verify Counter Workflow
    expect(workflowRuns[0].workflow_name).toBe("Counter Workflow");
    expect(workflowRuns[0].status).toBe(STATUS.COMPLETE);
    expect(workflowRuns[0].error).toBe(null);
    expect(workflowRuns[0].created_at).toBeTruthy();
    expect(workflowRuns[0].completed_at).toBeTruthy();

    // Verify Name Workflow
    expect(workflowRuns[1].workflow_name).toBe("Name Workflow");
    expect(workflowRuns[1].status).toBe(STATUS.COMPLETE);
    expect(workflowRuns[1].error).toBe(null);
    expect(workflowRuns[1].created_at).toBeTruthy();
    expect(workflowRuns[1].completed_at).toBeTruthy();

    // Query workflow steps for both workflows
    const allSteps = db.prepare(`
      SELECT s.*
      FROM workflow_steps s
      JOIN workflow_runs r ON s.workflow_run_id = r.id
      ORDER BY r.created_at ASC, s.step_order ASC
    `).all() as any[];

    expect(allSteps).toHaveLength(2);

    // Verify Counter Workflow Step
    expect(allSteps[0].title).toBe("Increment");
    expect(JSON.parse(allSteps[0].patch)).toEqual([
      { op: "replace", path: "/count", value: 1 }
    ]);
    expect(allSteps[0].status).toBe(STATUS.COMPLETE);
    expect(allSteps[0].created_at).toBeTruthy();
    expect(allSteps[0].started_at).toBeTruthy();
    expect(allSteps[0].completed_at).toBeTruthy();
    expect(allSteps[0].step_order).toBe(0);

    // Verify Name Workflow Step
    expect(allSteps[1].title).toBe("Uppercase");
    expect(JSON.parse(allSteps[1].patch)).toEqual([
      { op: "replace", path: "/name", value: "TEST" }
    ]);
    expect(allSteps[1].status).toBe(STATUS.COMPLETE);
    expect(allSteps[1].created_at).toBeTruthy();
    expect(allSteps[1].started_at).toBeTruthy();
    expect(allSteps[1].completed_at).toBeTruthy();
    expect(allSteps[1].step_order).toBe(0);
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
        client: mockClient,
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
    expect(workflowRun.created_at).toBeTruthy();
    expect(workflowRun.completed_at).toBeTruthy();

    const steps = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order ASC"
    ).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("Maybe Error");
    expect(steps[0].patch).toBeNull(); // No patch since the step errored
    expect(steps[0].status).toBe(STATUS.ERROR);
    expect(steps[0].created_at).toBeTruthy();
    expect(steps[0].started_at).toBeTruthy();
    expect(steps[0].completed_at).toBeTruthy();
    expect(steps[0].step_order).toBe(0);
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
      client: mockClient,
    })) {
      await adapter.dispatch(event);
    }

    // Verify workflow state after completion
    const workflowRun = db.prepare(
      "SELECT * FROM workflow_runs WHERE workflow_name = ?"
    ).get("Multi Step Workflow") as any;

    expect(workflowRun.status).toBe(STATUS.COMPLETE);
    expect(workflowRun.error).toBe(null);
    expect(workflowRun.created_at).toBeTruthy();
    expect(workflowRun.completed_at).toBeTruthy();

    // Verify steps
    const steps = db.prepare(`
      SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY step_order ASC
    `).all(workflowRun.id) as any[];

    expect(steps).toHaveLength(2);

    // Verify first step
    expect(steps[0].title).toBe("Uppercase String");
    expect(JSON.parse(steps[0].patch)).toEqual([
      { op: "replace", path: "/value", value: "TEST" }
    ]);
    expect(steps[0].status).toBe(STATUS.COMPLETE);
    expect(steps[0].created_at).toBeTruthy();
    expect(steps[0].started_at).toBeTruthy();
    expect(steps[0].completed_at).toBeTruthy();
    expect(steps[0].step_order).toBe(0);

    // Verify second step
    expect(steps[1].title).toBe("Increment Counter");
    expect(JSON.parse(steps[1].patch)).toEqual([
      { op: "replace", path: "/count", value: 1 }
    ]);
    expect(steps[1].status).toBe(STATUS.COMPLETE);
    expect(steps[1].created_at).toBeTruthy();
    expect(steps[1].started_at).toBeTruthy();
    expect(steps[1].completed_at).toBeTruthy();
    expect(steps[1].step_order).toBe(1);
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

    const adapter = new SQLiteAdapter(db);
    let workflowRunId: string | undefined;
    let completedStepIds: string[] = [];

    // Run initial workflow and capture step IDs
    for await (const event of fourStepWorkflow.run({
      initialState: { value: 2 },
      client: mockClient,
    })) {
      await adapter.dispatch(event);
      if (event.type === WORKFLOW_EVENTS.START) {
        workflowRunId = event.workflowRunId;
      } else if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
        completedStepIds = event.steps.map(step => step.id);
      }
    }

    if (!workflowRunId) {
      throw new Error("Failed to get workflow run ID");
    }

    // Get the first two completed steps
    const completedSteps = db.prepare(`
      SELECT id, title, status, patch, created_at, started_at, completed_at
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
      LIMIT 2
    `).all(workflowRunId) as any[];

    completedSteps.forEach(step => {
      step.patch = JSON.parse(step.patch);
    });

    // Start the restart with completed steps
    const restartIterator = fourStepWorkflow.run({
      workflowRunId,
      initialState: { value: 2 },
      initialCompletedSteps: completedSteps,
      client: mockClient,
    });

    // Process only the RESTART event
    await nextStep(restartIterator); // workflow start
    const restartEvent = await nextStep(restartIterator); // step status
    const { steps } = restartEvent as StepStatusEvent;
    await adapter.dispatch(restartEvent);

    // Verify that the first two steps maintain their original IDs
    expect(steps[0].id).toBe(completedStepIds[0]);
    expect(steps[1].id).toBe(completedStepIds[1]);
    // Verify that new steps get new IDs
    expect(steps[2].id).not.toBe(completedStepIds[2]);
    expect(steps[3].id).not.toBe(completedStepIds[3]);

    // Complete the rest of the workflow
    let finalSteps: SerializedStep[] = [];
    for await (const event of restartIterator) {
      await adapter.dispatch(event);
      if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
        finalSteps = event.steps;
      }
    }
    // Verify final state is correct
    const dbSteps = db.prepare(`
      SELECT title, status, patch
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC, id DESC
    `).all(workflowRunId) as any[];

    // Verify patches match between database and final steps
    dbSteps.forEach((dbStep, index) => {
      expect(dbStep.patch).toBe(JSON.stringify(finalSteps[index].patch));
      expect(dbStep.status).toBe(finalSteps[index].status);
      expect(dbStep.title).toBe(finalSteps[index].title);
    });
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
      client: mockClient,
    });

    // First event (workflow started)
    const startEvent = await nextStep(workflowIterator);
    await adapter.dispatch(startEvent);
    const { workflowRunId } = startEvent as WorkflowStartEvent;
    // Check initial workflow state
    const initialRun = db.prepare(`
      SELECT id, created_at, completed_at
      FROM workflow_runs
      WHERE id = ?
    `).get(workflowRunId) as any;

    expect(initialRun.created_at).toBeTruthy();
    expect(initialRun.completed_at).toBeNull();

    const stepStatusEvent = await nextStep(workflowIterator);
    await adapter.dispatch(stepStatusEvent);

    // Check initial step state
    const [firstStep] = db.prepare(`
      SELECT created_at, started_at, completed_at, status, step_order
      FROM workflow_steps
      WHERE workflow_run_id = ?
      ORDER BY step_order ASC
    `).all(workflowRunId) as any[];

    // Verify steps are created upfront
    expect(firstStep.created_at).toBeTruthy();
    expect(firstStep.started_at).toBeNull();
    expect(firstStep.completed_at).toBeNull();
    expect(firstStep.status).toBe('pending');

    // Second event (step start)
    const stepStartEvent = await nextStep(workflowIterator);
    await adapter.dispatch(stepStartEvent);

    const stepFinishEvent = await nextStep(workflowIterator);
    await adapter.dispatch(stepFinishEvent);

    await adapter.dispatch(await nextStep(workflowIterator));

    // Check step state after step is done
    const startedStep = db.prepare(`
      SELECT created_at, started_at, completed_at, status
      FROM workflow_steps
      WHERE workflow_run_id = ?
    `).get(workflowRunId) as any;

    expect(startedStep.created_at).toBeTruthy();
    expect(startedStep.started_at).toBeTruthy();
    expect(startedStep.completed_at).toBeTruthy();
    expect(startedStep.status).toBe(STATUS.COMPLETE);

    await adapter.dispatch(await nextStep(workflowIterator));

    // Check final workflow state
    const finalRun = db.prepare(`
      SELECT completed_at
      FROM workflow_runs
      WHERE id = ?
    `).get(workflowRunId) as any;
    expect(finalRun.completed_at).toBeTruthy();
  });

  it("should handle concurrent workflow executions correctly", async () => {
    interface TestState extends State {
      value: number;
    }

    const testWorkflow = workflow<{}, TestState>("Concurrent Test")
      .step("Step 1", async ({ state }) => {
        // Add small delay to better simulate concurrent execution
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          value: state.value + 1
        };
      });

    // Run three workflows concurrently, each with its own adapter
    const adapter1 = new SQLiteAdapter(db);
    const adapter2 = new SQLiteAdapter(db);
    const adapter3 = new SQLiteAdapter(db);

    const runWorkflow = async (adapter: SQLiteAdapter, initialValue: number) => {
      for await (const event of testWorkflow.run({
        initialState: { value: initialValue },
        client: mockClient,
      })) {
        await adapter.dispatch(event);
      }
    };

    // Start all workflows concurrently
    await Promise.all([
      runWorkflow(adapter1, 10),
      runWorkflow(adapter2, 20),
      runWorkflow(adapter3, 30)
    ]);

    // Verify all three workflow runs were recorded correctly
    const runs = db.prepare(`
      SELECT * FROM workflow_runs
      WHERE workflow_name = 'Concurrent Test'
      ORDER BY created_at ASC
    `).all() as any[];

    expect(runs).toHaveLength(3);
    runs.forEach(run => {
      expect(run.status).toBe(STATUS.COMPLETE);
    });

    // Verify all workflow steps were recorded correctly
    const steps = db.prepare(`
      SELECT s.*, r.id as run_id
      FROM workflow_steps s
      JOIN workflow_runs r ON s.workflow_run_id = r.id
      WHERE r.workflow_name = 'Concurrent Test'
      ORDER BY r.created_at ASC
    `).all() as any[];

    expect(steps).toHaveLength(3);
    steps.forEach(step => {
      expect(step.title).toBe("Step 1");
      expect(step.status).toBe(STATUS.COMPLETE);
    });

    // Verify the patches contain the right values
    const stepValues = steps.map(step => JSON.parse(step.patch))
      .map(patch => patch[0].value);

    // The values should be 11, 21, 31 (each initial value + 1)
    expect(stepValues).toEqual([11, 21, 31]);
  });
});