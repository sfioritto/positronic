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

  it("Create and watch a workflow run", async () => {
    const testEnv = env as TestEnv;
    const workflowName = "basic-workflow";

    const request = new Request("http://example.com/workflows/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowName }),
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);

    expect(response.status).toBe(201);
    const responseBody = await response.json<{ workflowRunId: string }>();
    expect(responseBody.workflowRunId).toBeDefined();
    expect(typeof responseBody.workflowRunId).toBe('string');

    const workflowRunId = responseBody.workflowRunId;
    await waitOnExecutionContext(context);

    // --- Verify the SSE stream from the API endpoint ---
    const watchUrl = `http://example.com/workflows/runs/${workflowRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

    expect(watchResponse.status).toBe(200);
    expect(watchResponse.headers.get('Content-Type')).toContain('text/event-stream');
    if (!watchResponse.body) {
      throw new Error("Watch response body is null");
    }
    // Read the first event from the stream
    const reader = watchResponse.body.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);

    // Cancel the reader to close the stream and stop the DO interval
    await reader.cancel();

    const decoder = new TextDecoder();
    const eventText = decoder.decode(value);
    const eventData = JSON.parse(eventText) as {
        status: string;
        error?: string | null;
        started_at?: number;
        completed_at?: number | null;
    };

    expect(eventData.status).toBe('complete');
  });

  it("Create and watch a delayed workflow run", async () => {
    const testEnv = env as TestEnv;
    const workflowName = "delayed-workflow";

    // Create the workflow run
    const createRequest = new Request("http://example.com/workflows/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createContext);
    expect(createResponse.status).toBe(201);
    const createResponseBody = await createResponse.json<{ workflowRunId: string }>();
    const workflowRunId = createResponseBody.workflowRunId;
    await waitOnExecutionContext(createContext);

    // Watch the workflow run via SSE
    const watchUrl = `http://example.com/workflows/runs/${workflowRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

    expect(watchResponse.status).toBe(200);
    expect(watchResponse.headers.get('Content-Type')).toContain('text/event-stream');
    if (!watchResponse.body) {
      throw new Error("Watch response body is null");
    }

    const reader = watchResponse.body.getReader();
    const decoder = new TextDecoder();

    // --- Read first event (expecting running) ---
    const { value: firstValue, done: firstDone } = await reader.read();
    expect(firstDone).toBe(false);
    const firstEventText = decoder.decode(firstValue);
    const firstEventData = JSON.parse(firstEventText) as { status: string };
    expect(firstEventData.status).toBe('running');

    // --- Read second event (expecting complete) ---
    const { value: secondValue, done: secondDone } = await reader.read();
    expect(secondDone).toBe(false);
    const secondEventText = decoder.decode(secondValue);
    const secondEventData = JSON.parse(secondEventText) as { status: string };
    expect(secondEventData.status).toBe('complete');

    // Cancel the stream
    await reader.cancel();

    // Wait for the watch context
    await waitOnExecutionContext(watchContext);
  });
});