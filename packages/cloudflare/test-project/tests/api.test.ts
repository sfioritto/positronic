import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";

import { describe, it, expect } from "vitest";
// Import the worker (which now points to the Hono app)
import worker from "../src/index";
// Import core types for better assertion
import { WORKFLOW_EVENTS, STATUS } from "@positronic/core";
import type {
  WorkflowEvent,
  WorkflowStartEvent,
  WorkflowCompleteEvent,
  StepStatusEvent,
  StepStartedEvent,
  StepCompletedEvent
} from "@positronic/core";
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

  // Helper function to read the entire SSE stream and collect events
  async function readSseStream(stream: ReadableStream<Uint8Array>): Promise<WorkflowEvent[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: WorkflowEvent[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Process any remaining buffer content
          if (buffer.trim().length > 0) {
            const event = parseSseEvent(buffer);
            if (event) events.push(event);
          }
          break; // Exit loop when stream is done
        }

        buffer += decoder.decode(value, { stream: true });
        // Process buffer line by line, looking for complete messages (ending in \n\n)
        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf("\n\n")) !== -1) {
          const message = buffer.substring(0, eventEndIndex);
          buffer = buffer.substring(eventEndIndex + 2); // Consume message + \n\n
          if (message.startsWith("data:")) {
            const event = parseSseEvent(message);
            if (event) {
              events.push(event);
              // Check for terminal events to potentially stop early (though reading until done is safer)
              // if (event.type === WORKFLOW_EVENTS.COMPLETE || event.type === WORKFLOW_EVENTS.ERROR) {
              //   reader.cancel(); // Optionally cancel if we know it's the end
              //   return events; // Return early
              // }
            }
          }
        }
      }
    } catch (e) {
        console.error("Error reading SSE stream:", e);
        throw e; // Re-throw error after logging
    } finally {
        // Ensure the reader is released even if an error occurs mid-stream
        // reader.releaseLock(); // releaseLock() might not be needed if using reader.cancel() or natural stream end
        // reader.cancel() might be called by the test explicitly, so avoid redundant cancellation.
        console.log(`Finished reading SSE stream, received ${events.length} events.`);
    }
    return events;
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

    // --- Create the workflow run ---
    const request = new Request("http://example.com/workflows/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowName }),
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    expect(response.status).toBe(201);
    const responseBody = await response.json<{ workflowRunId: string }>();
    const workflowRunId = responseBody.workflowRunId;
    await waitOnExecutionContext(context);

    // --- Watch the workflow run via SSE ---
    const watchUrl = `http://example.com/workflows/runs/${workflowRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

    expect(watchResponse.status).toBe(200);
    expect(watchResponse.headers.get('Content-Type')).toContain('text/event-stream');
    if (!watchResponse.body) {
      throw new Error("Watch response body is null");
    }

    // --- Read all events from the SSE stream ---
    const allEvents = await readSseStream(watchResponse.body);

    // --- Assertions on the collected events ---
    // Check for start event
    const startEvent = allEvents.find((e): e is WorkflowStartEvent => e.type === WORKFLOW_EVENTS.START);
    expect(startEvent).toBeDefined();
    expect(startEvent?.workflowTitle).toBe(workflowName);
    expect(startEvent?.status).toBe(STATUS.RUNNING);

    // Check for complete event
    const completeEvent = allEvents.find((e): e is WorkflowCompleteEvent => e.type === WORKFLOW_EVENTS.COMPLETE);
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Check the final step status event
    const stepStatusEvents = allEvents.filter((e): e is StepStatusEvent => e.type === WORKFLOW_EVENTS.STEP_STATUS);
    expect(stepStatusEvents.length).toBeGreaterThan(0);
    const lastStepStatusEvent = stepStatusEvents[stepStatusEvents.length - 1];
    expect(lastStepStatusEvent.steps.every((step: any) => step.status === STATUS.COMPLETE)).toBe(true);

    // Check for specific step completion if needed (depends on basic-workflow structure)
    const stepCompleteEvents = allEvents.filter((e): e is StepCompletedEvent => e.type === WORKFLOW_EVENTS.STEP_COMPLETE);
    expect(stepCompleteEvents.length).toBeGreaterThanOrEqual(1); // Assuming basic-workflow has at least one step

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

    // --- Read all events from the SSE stream ---
    const allEvents = await readSseStream(watchResponse.body);

    // --- Assertions on the collected events ---
    // Check for start event
    const startEvent = allEvents.find((e): e is WorkflowStartEvent => e.type === WORKFLOW_EVENTS.START);
    expect(startEvent).toBeDefined();
    expect(startEvent?.workflowTitle).toBe(workflowName);
    expect(startEvent?.status).toBe(STATUS.RUNNING);

    // Check for step start/complete events for the delayed step
    const delayStepStart = allEvents.find((e): e is StepStartedEvent => e.type === WORKFLOW_EVENTS.STEP_START && e.stepTitle === 'Delay Step');
    expect(delayStepStart).toBeDefined();
    const delayStepComplete = allEvents.find((e): e is StepCompletedEvent => e.type === WORKFLOW_EVENTS.STEP_COMPLETE && e.stepTitle === 'Delay Step');
    expect(delayStepComplete).toBeDefined();

    // Check for the final complete event
    const completeEvent = allEvents.find((e): e is WorkflowCompleteEvent => e.type === WORKFLOW_EVENTS.COMPLETE);
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Check the final step status event shows completion
    const stepStatusEvents = allEvents.filter((e): e is StepStatusEvent => e.type === WORKFLOW_EVENTS.STEP_STATUS);
    expect(stepStatusEvents.length).toBeGreaterThan(0);
    const lastStepStatusEvent = stepStatusEvents[stepStatusEvents.length - 1];
    expect(lastStepStatusEvent.steps.every((step: any) => step.status === STATUS.COMPLETE)).toBe(true);

    await waitOnExecutionContext(watchContext);
    // Add a small delay to allow async operations to potentially settle
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 30000);
});