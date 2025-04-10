import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";

import { describe, it, expect } from "vitest";
// Import the worker (which now points to the Hono app)
import worker from "../src/index";
import type { WorkflowRunnerDO } from "../../src/workflow-runner-do.js"; // Import the DO class

// Define the expected Env shape based on wrangler.jsonc for type safety in tests
interface TestEnv {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace<WorkflowRunnerDO>; // Use the correct binding name and type
  DB: D1Database;
}

describe("Hono API Tests", () => {
  it("POST /runs without workflowName should return 400", async () => {
    // Cast the test env to the expected shape for type checking
    const testEnv = env as TestEnv;

    const request = new Request("http://example.com/workflows/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Empty body, no workflowName
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(400);
    // Optionally, check the error message in the response body
    const responseBody = await response.json();
    expect(responseBody).toEqual({ error: 'Missing workflowName in request body' });
  });

  it("POST /workflows/runs with workflowName should return 201 and create a DO instance", async () => {
    const testEnv = env as TestEnv;
    const workflowName = "basic-workflow";

    const request = new Request("http://example.com/workflows/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowName }),
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(201);
    const responseBody = await response.json<{ workflowRunId: string }>();
    expect(responseBody.workflowRunId).toBeDefined();
    expect(typeof responseBody.workflowRunId).toBe('string');

    // --- Verify the DO was created and started ---
    const workflowRunId = responseBody.workflowRunId;
    const doId = testEnv.WORKFLOW_RUNNER_DO.idFromName(workflowRunId);
    const stub = testEnv.WORKFLOW_RUNNER_DO.get(doId);

    // Fetch the /isStarted endpoint from the DO stub
    const doResponse = await stub.fetch("http://do/isStarted");
    expect(doResponse.status).toBe(200);
    // Check the response body for started status and the result
    const doResponseBody = await doResponse.json<{ started: boolean; result?: string }>();
    expect(doResponseBody.started).toBe(true);
    // Assert that the result matches the output of helloWorld()
    expect(doResponseBody.result).toBe("Hello, World!");
  });

  // Add more tests here later...
});