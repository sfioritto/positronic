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
  // Helper to parse SSE data field
  function parseSseEvent(text: string): any | null {
    const lines = text.trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.substring(6)); // Length of "data: "
        } catch (e) {
          console.error("Failed to parse SSE data:", line.substring(6), e);
          return null;
        }
      }
    }
    return null;
  }

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

    const decoder = new TextDecoder();
    const eventText = decoder.decode(value);

    // --- Read first event (overall status) ---
    const firstEventData = parseSseEvent(eventText);
    expect(firstEventData).toHaveProperty('status');
    // Basic workflow is fast, might be running or complete already
    expect(['running', 'complete']).toContain(firstEventData.status);

    // --- Read second event (initial steps) ---
    const { value: secondValue, done: secondDone } = await reader.read();
    expect(secondDone).toBe(false);
    const secondEventText = decoder.decode(secondValue);
    const secondEventData = parseSseEvent(secondEventText);
    expect(secondEventData).toHaveProperty('type', 'step:status');
    expect(secondEventData).toHaveProperty('steps');
    expect(Array.isArray(secondEventData.steps)).toBe(true);

    // --- Read subsequent events until complete (if not already) ---
    let lastStepsEvent = secondEventData;
    while (lastStepsEvent.steps.some((step: any) => step.status !== 'complete')) {
        const { value: nextValue, done: nextDone } = await reader.read();
        expect(nextDone).toBe(false);
        const nextEventText = decoder.decode(nextValue);
        const nextEventData = parseSseEvent(nextEventText);
        expect(nextEventData).toHaveProperty('type', 'step:status');
        lastStepsEvent = nextEventData;
    }

    // Verify the final step status event shows completion
    expect(lastStepsEvent.steps.every((step: any) => step.status === 'complete')).toBe(true);

    await reader.cancel();
    await waitOnExecutionContext(watchContext);
  });

  // Increase timeout for this longer-running test
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

    // --- Read first event (overall status) ---
    const { value: firstValue, done: firstDone } = await reader.read();
    expect(firstDone).toBe(false);
    const firstEventText = decoder.decode(firstValue);

    const firstEventData = parseSseEvent(firstEventText);
    expect(firstEventData).toHaveProperty('status', 'running');

    // --- Read second event (initial steps - should be pending) ---
    const { value: secondValue, done: secondDone } = await reader.read();
    expect(secondDone).toBe(false);
    const secondEventText = decoder.decode(secondValue);

    const secondEventData = parseSseEvent(secondEventText);
    expect(secondEventData).toHaveProperty('type', 'step:status');
    expect(secondEventData).toHaveProperty('steps');
    expect(Array.isArray(secondEventData.steps)).toBe(true);
    // Initially, steps might be pending
    // expect(secondEventData.steps.every((step: any) => step.status === 'pending')).toBe(true);

    // --- Read subsequent STEP_STATUS events until all steps are complete ---
    let lastStepsEvent = secondEventData;
    while (lastStepsEvent.steps.some((step: any) => step.status !== 'complete')) {
        console.log('Waiting for completion, current steps:', JSON.stringify(lastStepsEvent.steps)); // Add logging
        const { value: nextValue, done: nextDone } = await reader.read();
        // If done is true here, the stream closed before completion, which is an error
        expect(nextDone).toBe(false);
        const nextEventText = decoder.decode(nextValue);
        const nextEventData = parseSseEvent(nextEventText);
        // Ensure we are getting step status updates
        expect(nextEventData).toHaveProperty('type', 'step:status');
        lastStepsEvent = nextEventData;
    }

    // Verify the final step status event shows completion
    expect(lastStepsEvent.steps.every((step: any) => step.status === 'complete')).toBe(true);

    // Cancel the stream
    await reader.cancel();
    await waitOnExecutionContext(watchContext);
    // Add a small delay to allow async operations to potentially settle
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 30000);
});