import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import { resetMockState } from '../src/runner';
import type {
  BrainEvent,
  BrainStartEvent,
  BrainCompleteEvent,
  StepStatusEvent,
  StepCompletedEvent,
  StepStartedEvent,
  LoopStartEvent,
  LoopToolCallEvent,
  LoopWebhookEvent,
  LoopToolResultEvent,
  WebhookResponseEvent,
  LoopCompleteEvent,
} from '@positronic/core';
import type { BrainRunnerDO } from '../../src/brain-runner-do.js';
import type { MonitorDO } from '../../src/monitor-do.js';
import type { ScheduleDO } from '../../src/schedule-do.js';

interface TestEnv {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
  DB: D1Database;
  RESOURCES_BUCKET: R2Bucket;
}

describe('Hono API Tests', () => {
  // Reset mock state before each test
  beforeEach(() => {
    resetMockState();
  });

  // Helper to parse SSE data field
  function parseSseEvent(text: string): any | null {
    const lines = text.trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const jsonData = line.substring(6); // Length of "data: "
          const parsed = JSON.parse(jsonData);
          return parsed;
        } catch (e) {
          console.error(
            '[TEST_SSE_PARSE] Failed to parse SSE data:',
            line.substring(6),
            e
          );
          return null;
        }
      }
    }
    return null;
  }

  // Helper function to read the entire SSE stream and collect events
  // Tracks brain nesting depth to only return when the outermost brain completes
  async function readSseStream(
    stream: ReadableStream<Uint8Array>
  ): Promise<BrainEvent[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: BrainEvent[] = [];
    let brainDepth = 0; // Track nesting depth for inner brains

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // Process any remaining buffer content
        if (buffer.trim().length > 0) {
          const event = parseSseEvent(buffer);
          if (event) {
            events.push(event);
          }
        }
        break; // Exit loop when stream is done
      }

      const decodedChunk = decoder.decode(value, { stream: true });
      buffer += decodedChunk;
      // Process buffer line by line, looking for complete messages (ending in \n\n)
      let eventEndIndex;
      while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
        const message = buffer.substring(0, eventEndIndex);
        buffer = buffer.substring(eventEndIndex + 2); // Consume message + \n\n
        if (message.startsWith('data:')) {
          const event = parseSseEvent(message);
          if (event) {
            events.push(event);

            // Track brain nesting depth
            // Only count START, not RESTART - RESTART continues an already-counted brain
            if (event.type === BRAIN_EVENTS.START) {
              brainDepth++;
            }

            if (event.type === BRAIN_EVENTS.COMPLETE) {
              brainDepth--;
              // Only return when the outermost brain completes (depth reaches 0)
              if (brainDepth <= 0) {
                reader.cancel(`Received terminal event: ${event.type}`);
                return events;
              }
            }
            // Note: WEBHOOK is NOT treated as terminal here because:
            // 1. Tests that need to stop at WEBHOOK use their own read loops
            // 2. When watching a resumed brain, we need to read past the historical
            //    WEBHOOK to see the RESTART and completion events
            if (event.type === BRAIN_EVENTS.ERROR) {
              console.error(
                'Received BRAIN_EVENTS.ERROR. Event details:',
                event
              );
              reader.cancel(`Received terminal event: ${event.type}`);
              throw new Error(
                `Received terminal event: ${
                  event.type
                }. Details: ${JSON.stringify(event)}`
              );
            }
          }
        }
      }
    }
    return events;
  }

  it('POST /brains/runs without brainName should return 400', async () => {
    const testEnv = env as TestEnv;

    const request = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // Empty body, check for missing brainTitle
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(400);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: 'Missing identifier or brainTitle in request body',
    });
  });

  it('POST /brains/runs with non-existent brain should return 404', async () => {
    const testEnv = env as TestEnv;
    const request = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: 'non-existent-brain' }),
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);
    expect(response.status).toBe(404);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: "Brain 'non-existent-brain' not found",
    });
  });

  it('Create and watch a brain run', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'basic-brain';

    // --- Create the brain run ---
    const request = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    expect(response.status).toBe(201);
    const responseBody = await response.json<{ brainRunId: string }>();
    const brainRunId = responseBody.brainRunId;
    await waitOnExecutionContext(context);

    // --- Watch the brain run via SSE ---
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );

    expect(watchResponse.status).toBe(200);
    expect(watchResponse.headers.get('Content-Type')).toContain(
      'text/event-stream'
    );
    if (!watchResponse.body) {
      throw new Error('Watch response body is null');
    }

    // --- Read all events from the SSE stream ---
    const allEvents = await readSseStream(watchResponse.body);

    // --- Assertions on the collected events ---
    // Check for start event
    const startEvent = allEvents.find(
      (e): e is BrainStartEvent => e.type === BRAIN_EVENTS.START
    );
    expect(startEvent).toBeDefined();
    expect(startEvent?.brainTitle).toBe('basic-brain');
    expect(startEvent?.status).toBe(STATUS.RUNNING);

    // Check for complete event
    const completeEvent = allEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Check the final step status event
    const stepStatusEvents = allEvents.filter(
      (e): e is StepStatusEvent => e.type === BRAIN_EVENTS.STEP_STATUS
    );
    expect(stepStatusEvents.length).toBeGreaterThan(0);
    const lastStepStatusEvent = stepStatusEvents[stepStatusEvents.length - 1];
    expect(
      lastStepStatusEvent.steps.every(
        (step: any) => step.status === STATUS.COMPLETE
      )
    ).toBe(true);

    // Check for specific step completion if needed (depends on basic-brain structure)
    const stepCompleteEvents = allEvents.filter(
      (e): e is StepCompletedEvent => e.type === BRAIN_EVENTS.STEP_COMPLETE
    );
    expect(stepCompleteEvents.length).toBeGreaterThanOrEqual(1); // Assuming basic-brain has at least one step

    await waitOnExecutionContext(watchContext);
  });

  it('Create and watch a delayed brain run', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'delayed-brain';

    // Create the brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    expect(createResponse.status).toBe(201);
    const createResponseBody = await createResponse.json<{
      brainRunId: string;
    }>();
    const brainRunId = createResponseBody.brainRunId;
    await waitOnExecutionContext(createContext);

    // Watch the brain run via SSE
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );

    expect(watchResponse.status).toBe(200);
    expect(watchResponse.headers.get('Content-Type')).toContain(
      'text/event-stream'
    );
    if (!watchResponse.body) {
      throw new Error('Watch response body is null');
    }

    // --- Read all events from the SSE stream ---
    const allEvents = await readSseStream(watchResponse.body);

    // --- Assertions on the collected events ---
    // Check for start event
    const startEvent = allEvents.find(
      (e): e is BrainStartEvent => e.type === BRAIN_EVENTS.START
    );
    expect(startEvent).toBeDefined();
    expect(startEvent?.brainTitle).toBe('delayed-brain');
    expect(startEvent?.status).toBe(STATUS.RUNNING);

    // Check for step start/complete events for the delayed step
    const delayStepStart = allEvents.find(
      (e): e is StepStartedEvent =>
        e.type === BRAIN_EVENTS.STEP_START && e.stepTitle === 'Start Delay'
    );
    expect(delayStepStart).toBeDefined();
    const delayStepComplete = allEvents.find(
      (e): e is StepCompletedEvent =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE && e.stepTitle === 'Start Delay'
    );
    expect(delayStepComplete).toBeDefined();

    // Check for the final complete event
    const completeEvent = allEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Check the final step status event shows completion
    const stepStatusEvents = allEvents.filter(
      (e): e is StepStatusEvent => e.type === BRAIN_EVENTS.STEP_STATUS
    );
    expect(stepStatusEvents.length).toBeGreaterThan(0);
    const lastStepStatusEvent = stepStatusEvents[stepStatusEvents.length - 1];
    expect(
      lastStepStatusEvent.steps.every(
        (step: any) => step.status === STATUS.COMPLETE
      )
    ).toBe(true);

    await waitOnExecutionContext(watchContext);
  });

  it('Asserts brainRunId is present in SSE events', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'basic-brain';

    // Create brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    const createResponseBody = await createResponse.json<{
      brainRunId: string;
    }>();
    const expectedBrainRunId = createResponseBody.brainRunId;
    await waitOnExecutionContext(createContext);

    // Watch brain run
    const watchUrl = `http://example.com/brains/runs/${expectedBrainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );

    // Get first event from stream
    const reader = watchResponse.body?.getReader();
    if (!reader) throw new Error('Watch response body is null');

    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    const event = parseSseEvent(chunk);

    // Cleanup
    reader.cancel();
    await waitOnExecutionContext(watchContext);

    // Assert
    expect(event.brainRunId).toBeDefined();
    expect(event.brainRunId).toBe(expectedBrainRunId);
  });

  it('Monitor receives brain events (checking brain run)', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'basic-brain';

    // Start the brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    // Watch the brain run via SSE until completion
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );
    await readSseStream(watchResponse.body!);
    await waitOnExecutionContext(watchContext);

    // Get the monitor singleton instance
    const monitorId = testEnv.MONITOR_DO.idFromName('singleton');
    const monitorStub = testEnv.MONITOR_DO.get(monitorId);
    const lastEvent = await monitorStub.getLastEvent(brainRunId);

    // The last event should be a brain complete event
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.type).toBe(BRAIN_EVENTS.COMPLETE);
    expect(lastEvent?.status).toBe(STATUS.COMPLETE);
  });

  it('Watches brain run as it runs', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'basic-brain';

    // Run the brain run twice
    for (let i = 0; i < 2; i++) {
      // Start the brain run
      const createRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();

      // Watch the brain run via SSE until completion
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );
      await readSseStream(watchResponse.body!);
      await waitOnExecutionContext(watchContext);
      await waitOnExecutionContext(createContext);
    }

    // Get brain run history
    const historyRequest = new Request(
      `http://example.com/brains/${brainName}/history?limit=5`
    );
    const historyContext = createExecutionContext();
    const historyResponse = await worker.fetch(
      historyRequest,
      testEnv,
      historyContext
    );
    await waitOnExecutionContext(historyContext);

    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json<{
      runs: Array<{
        brainRunId: string;
        brainTitle: string;
        brainDescription: string | null;
        type: string;
        status: string;
        options: string;
        error: string | null;
        createdAt: number;
        startedAt: number | null;
        completedAt: number | null;
      }>;
    }>();
    expect(history.runs.length).toBe(2);

    // Verify each run has the expected properties
    for (const run of history.runs) {
      expect(run).toHaveProperty('brainRunId');
      expect(run).toHaveProperty('brainTitle');
      expect(run).toHaveProperty('brainDescription');
      expect(run).toHaveProperty('type');
      expect(run).toHaveProperty('status');
      expect(run).toHaveProperty('options');
      expect(run).toHaveProperty('error');
      expect(run).toHaveProperty('createdAt');
      expect(run).toHaveProperty('startedAt');
      expect(run).toHaveProperty('completedAt');
      expect(run.status).toBe(STATUS.COMPLETE);
      expect(run.brainTitle).toBe(brainName);
    }

    // Verify runs are ordered by createdAt descending
    const timestamps = history.runs.map(
      (run: { createdAt: number }) => run.createdAt
    );
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('Watch endpoint streams running brains', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'delayed-brain';
    const brainRuns: string[] = [];

    // Start 3 delayed brains
    for (let i = 0; i < 3; i++) {
      const createRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      brainRuns.push(brainRunId);
      await waitOnExecutionContext(createContext);
    }

    // Connect to watch endpoint
    const watchRequest = new Request('http://example.com/brains/watch');
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );
    expect(watchResponse.status).toBe(200);
    expect(watchResponse.headers.get('Content-Type')).toContain(
      'text/event-stream'
    );

    if (!watchResponse.body) {
      throw new Error('Watch response body is null');
    }

    // Read the SSE stream
    const events: any[] = [];
    const reader = watchResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Helper to process SSE messages
    const processBuffer = () => {
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || ''; // Keep the incomplete message in the buffer

      for (const message of messages) {
        if (message.startsWith('data: ')) {
          const data = JSON.parse(message.slice(6));
          events.push(data);
        }
      }
    };

    // Read for a while to capture brain completions
    const startTime = Date.now();
    const TIMEOUT = 5000; // 5 seconds should be enough for our test brains

    try {
      while (Date.now() - startTime < TIMEOUT) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        processBuffer();

        // If we've seen all brains complete, we can stop early
        const lastEvent = events[events.length - 1];
        if (lastEvent?.runningBrains?.length === 0) {
          break;
        }
      }
    } finally {
      reader.cancel();
    }

    // Verify the events
    expect(events.length).toBeGreaterThan(0);

    // First event should show all brains running
    const initialState = events[0];
    expect(initialState.runningBrains).toBeDefined();
    expect(initialState.runningBrains.length).toBe(3);
    expect(
      initialState.runningBrains.every((w: any) => w.status === STATUS.RUNNING)
    ).toBe(true);

    // Last event should show no running brains
    const finalState = events[events.length - 1];
    expect(finalState.runningBrains).toBeDefined();
    expect(finalState.runningBrains.length).toBe(0);

    await waitOnExecutionContext(watchContext);
  });

  it('Loads resources from the resource manifest', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'resource-brain';

    // First, set up test resources in R2
    // Create testResource
    await testEnv.RESOURCES_BUCKET.put(
      'testResource.txt',
      'This is a test resource',
      {
        customMetadata: {
          type: 'text',
          path: 'testResource.txt',
        },
      }
    );

    // Create testResourceBinary
    await testEnv.RESOURCES_BUCKET.put(
      'testResourceBinary.bin',
      'This is a test resource binary',
      {
        customMetadata: {
          type: 'binary',
          path: 'testResourceBinary.bin',
        },
      }
    );

    // Create nested resource
    await testEnv.RESOURCES_BUCKET.put(
      'nestedResource/testNestedResource.txt',
      'This is a test resource',
      {
        customMetadata: {
          type: 'text',
          path: 'nestedResource/testNestedResource.txt',
        },
      }
    );

    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    const { brainRunId } = await createResponse.json<{
      brainRunId: string;
    }>();
    await waitOnExecutionContext(createContext);

    // Watch the brain run via SSE until completion
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );
    expect(watchResponse.status).toBe(200); // Ensure watch connection is OK
    if (!watchResponse.body) {
      throw new Error('Watch response body is null');
    }

    // --- Read all events from the SSE stream ---
    const allEvents = await readSseStream(watchResponse.body);
    await waitOnExecutionContext(watchContext); // Wait for SSE stream processing and DOs to settle

    // --- Assertions on the collected events ---

    // Check for overall brain completion
    const completeEvent = allEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Find the step completion events
    const stepCompleteEvents = allEvents.filter(
      (e): e is StepCompletedEvent => e.type === BRAIN_EVENTS.STEP_COMPLETE
    );

    const loadTextStepCompleteEvent = stepCompleteEvents.find(
      (e) => e.stepTitle === 'Load text resource'
    );
    expect(loadTextStepCompleteEvent).toBeDefined();
    expect(loadTextStepCompleteEvent?.patch).toBeDefined();

    const loadBinaryStepCompleteEvent = stepCompleteEvents.find(
      (e) => e.stepTitle === 'Load binary resource'
    );
    expect(loadBinaryStepCompleteEvent).toBeDefined();
    expect(loadBinaryStepCompleteEvent?.patch).toBeDefined();

    // Expected resource content from packages/cloudflare/test-project/src/runner.ts
    const expectedTextContent = 'This is a test resource';
    const expectedBinaryContentRaw = 'This is a test resource binary';
    const expectedBinaryContentBase64 = Buffer.from(
      expectedBinaryContentRaw
    ).toString('base64');

    // Verify the patch from 'Load text resource' step
    // This patch is relative to the state *before* this step
    const textPatch = loadTextStepCompleteEvent!.patch;
    const addTextOp = textPatch.find(
      (op) => op.op === 'add' && op.path === '/text'
    );
    expect(addTextOp).toBeDefined();
    expect(addTextOp?.value).toBe(expectedTextContent);

    // Verify the patch from 'Load binary resource' step
    // This patch is relative to the state *after* 'Load text resource' step
    const binaryPatch = loadBinaryStepCompleteEvent!.patch;
    const addBufferOp = binaryPatch.find(
      (op) => op.op === 'add' && op.path === '/buffer'
    );
    expect(addBufferOp).toBeDefined();
    expect(addBufferOp?.value).toBe(expectedBinaryContentBase64);

    // Verify the patch from 'Load nested resource' step
    const loadNestedStepCompleteEvent = stepCompleteEvents.find(
      (e) => e.stepTitle === 'Load nested resource'
    );
    expect(loadNestedStepCompleteEvent).toBeDefined();
    expect(loadNestedStepCompleteEvent?.patch).toBeDefined();
    const nestedTextPatch = loadNestedStepCompleteEvent!.patch;
    const addNestedTextOp = nestedTextPatch.find(
      (op) => op.op === 'add' && op.path === '/nestedText'
    );
    expect(addNestedTextOp).toBeDefined();
    // The mock loader will return 'This is a test resource' for any text request.
    expect(addNestedTextOp?.value).toBe(expectedTextContent);

    // Check that the steps themselves are marked as completed in the final status
    const stepStatusEvents = allEvents.filter(
      (e): e is StepStatusEvent => e.type === BRAIN_EVENTS.STEP_STATUS
    );
    expect(stepStatusEvents.length).toBeGreaterThan(0);
    const lastStepStatusEvent = stepStatusEvents[stepStatusEvents.length - 1];

    expect(lastStepStatusEvent.steps.length).toBe(3); // resource-brain has 3 steps
    const textStepFinalStatus = lastStepStatusEvent.steps.find(
      (s) => s.title === 'Load text resource'
    );
    const binaryStepFinalStatus = lastStepStatusEvent.steps.find(
      (s) => s.title === 'Load binary resource'
    );
    const nestedStepFinalStatus = lastStepStatusEvent.steps.find(
      (s) => s.title === 'Load nested resource'
    );

    expect(textStepFinalStatus?.status).toBe(STATUS.COMPLETE);
    expect(binaryStepFinalStatus?.status).toBe(STATUS.COMPLETE);
    expect(nestedStepFinalStatus?.status).toBe(STATUS.COMPLETE);

    // Clean up test resources
    await testEnv.RESOURCES_BUCKET.delete('testResource.txt');
    await testEnv.RESOURCES_BUCKET.delete('testResourceBinary.bin');
    await testEnv.RESOURCES_BUCKET.delete(
      'nestedResource/testNestedResource.txt'
    );
  });

  describe('Brain Schedules API Tests', () => {
    it('POST /brains/schedules creates a new schedule', async () => {
      const testEnv = env as TestEnv;
      const identifier = 'basic-brain';
      const cronExpression = '0 3 * * *'; // Daily at 3am

      const request = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: identifier, cronExpression }),
      });
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(201);
      const responseBody = await response.json<{
        id: string;
        brainTitle: string;
        cronExpression: string;
        enabled: boolean;
        createdAt: number;
      }>();

      expect(responseBody.id).toBeDefined();
      expect(responseBody.brainTitle).toBe(identifier);
      expect(responseBody.cronExpression).toBe(cronExpression);
      expect(responseBody.enabled).toBe(true);
      expect(responseBody.createdAt).toBeDefined();
    });

    it('GET /brains/schedules lists all schedules', async () => {
      const testEnv = env as TestEnv;

      // Create a few schedules first
      const brainNames = ['basic-brain', 'delayed-brain', 'resource-brain'];
      for (let i = 0; i < brainNames.length; i++) {
        const request = new Request('http://example.com/brains/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brainTitle: brainNames[i],
            cronExpression: `${i} * * * *`,
          }),
        });
        const context = createExecutionContext();
        await worker.fetch(request, testEnv, context);
        await waitOnExecutionContext(context);
      }

      // List schedules
      const listRequest = new Request('http://example.com/brains/schedules');
      const listContext = createExecutionContext();
      const listResponse = await worker.fetch(
        listRequest,
        testEnv,
        listContext
      );
      await waitOnExecutionContext(listContext);

      expect(listResponse.status).toBe(200);
      const responseBody = await listResponse.json<{
        schedules: Array<{
          id: string;
          brainTitle: string;
          cronExpression: string;
          enabled: boolean;
          createdAt: number;
        }>;
        count: number;
      }>();

      expect(responseBody.schedules).toBeInstanceOf(Array);
      expect(responseBody.count).toBeGreaterThanOrEqual(3);
    });

    it('DELETE /brains/schedules/:scheduleId deletes a schedule', async () => {
      const testEnv = env as TestEnv;

      // Create a schedule
      const createRequest = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brainTitle: 'options-brain',
          cronExpression: '0 0 * * *',
        }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      const { id } = await createResponse.json<{ id: string }>();
      await waitOnExecutionContext(createContext);

      // Delete the schedule
      const deleteRequest = new Request(
        `http://example.com/brains/schedules/${id}`,
        {
          method: 'DELETE',
        }
      );
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        testEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const getRequest = new Request(
        `http://example.com/brains/schedules/${id}`
      );
      const getContext = createExecutionContext();
      const getResponse = await worker.fetch(getRequest, testEnv, getContext);
      await waitOnExecutionContext(getContext);

      expect(getResponse.status).toBe(404);
    });

    it('GET /brains/schedules/runs lists scheduled run history', async () => {
      const testEnv = env as TestEnv;

      const request = new Request('http://example.com/brains/schedules/runs');
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(200);
      const responseBody = await response.json<{
        runs: Array<{
          id: number;
          scheduleId: string;
          brainRunId?: string;
          status: 'triggered' | 'failed';
          ranAt: number;
        }>;
        count: number;
      }>();

      expect(responseBody.runs).toBeInstanceOf(Array);
      expect(typeof responseBody.count).toBe('number');
    });

    it('GET /brains/schedules/runs with scheduleId filter', async () => {
      const testEnv = env as TestEnv;
      const scheduleId = 'test-schedule-123';

      const request = new Request(
        `http://example.com/brains/schedules/runs?scheduleId=${scheduleId}`
      );
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(200);
      const responseBody = await response.json<{
        runs: Array<{
          id: number;
          scheduleId: string;
          brainRunId?: string;
          status: 'triggered' | 'failed';
          ranAt: number;
        }>;
        count: number;
      }>();

      // All runs should belong to the specified schedule
      for (const run of responseBody.runs) {
        expect(run.scheduleId).toBe(scheduleId);
      }
    });

    it('POST /brains/schedules validates cron expression', async () => {
      const testEnv = env as TestEnv;

      const request = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brainTitle: 'invalid-cron-brain',
          cronExpression: 'invalid cron',
        }),
      });
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(400);
      const error = (await response.json()) as { error: string };
      expect(error.error).toContain('Invalid cron expression');
    });

    it('POST /brains/schedules allows multiple schedules per brain', async () => {
      const testEnv = env as TestEnv;
      const identifier = 'basic-brain';

      // Create first schedule
      const request1 = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brainTitle: identifier,
          cronExpression: '0 9 * * *', // 9am daily
        }),
      });
      const context1 = createExecutionContext();
      const response1 = await worker.fetch(request1, testEnv, context1);
      await waitOnExecutionContext(context1);
      expect(response1.status).toBe(201);

      // Create second schedule for same brain
      const request2 = new Request('http://example.com/brains/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brainTitle: identifier,
          cronExpression: '0 17 * * *', // 5pm daily
        }),
      });
      const context2 = createExecutionContext();
      const response2 = await worker.fetch(request2, testEnv, context2);
      await waitOnExecutionContext(context2);
      expect(response2.status).toBe(201);

      // Verify both schedules exist
      const listRequest = new Request('http://example.com/brains/schedules');
      const listContext = createExecutionContext();
      const listResponse = await worker.fetch(
        listRequest,
        testEnv,
        listContext
      );
      await waitOnExecutionContext(listContext);

      const { schedules } = await listResponse.json<{
        schedules: Array<{ brainTitle: string }>;
      }>();

      const multiSchedules = schedules.filter(
        (s) => s.brainTitle === 'basic-brain'
      );
      expect(multiSchedules.length).toBe(2);
    });
  });

  describe('Brain title vs filename resolution', () => {
    it('should handle brain run creation with brain title (not filename)', async () => {
      const testEnv = env as TestEnv;

      // Create brain run using the brain's title instead of filename
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'Brain with Custom Title' }),
      });

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(201);

      const responseBody = await response.json<{ brainRunId: string }>();
      const brainRunId = responseBody.brainRunId;
      await waitOnExecutionContext(context);

      // Watch the brain run to ensure it executes properly
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      expect(watchResponse.status).toBe(200);

      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      // Read all events from the SSE stream
      const allEvents = await readSseStream(watchResponse.body);

      // Should have received completion event
      const completeEvent = allEvents.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe(STATUS.COMPLETE);

      await waitOnExecutionContext(watchContext);
    });

    it('should handle brain run creation with filename', async () => {
      const testEnv = env as TestEnv;

      // Create brain run using the filename
      const request = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'title-test-brain' }),
      });

      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(201);

      const responseBody = await response.json<{ brainRunId: string }>();
      const brainRunId = responseBody.brainRunId;
      await waitOnExecutionContext(context);

      // Watch the brain run to ensure it executes properly
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      expect(watchResponse.status).toBe(200);

      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      // Read all events from the SSE stream
      const allEvents = await readSseStream(watchResponse.body);

      // Should have received completion event
      const completeEvent = allEvents.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe(STATUS.COMPLETE);

      await waitOnExecutionContext(watchContext);
    });
  });

  describe('Webhook Brain Resumption', () => {
    it('should pause brain on webhook and resume when webhook is received', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'webhook-brain';
      const webhookIdentifier = 'test-thread-123';

      // Step 1: Start the webhook-brain
      const createRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      expect(createResponse.status).toBe(201);
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Step 2: Watch the brain - it should pause with WEBHOOK event
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      expect(watchResponse.status).toBe(200);
      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      // Read events until we get the WEBHOOK event (brain pauses)
      const reader = watchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const events: BrainEvent[] = [];
      let foundWebhookEvent = false;

      while (!foundWebhookEvent) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.substring(0, eventEndIndex);
          buffer = buffer.substring(eventEndIndex + 2);

          if (message.startsWith('data:')) {
            const event = parseSseEvent(message);
            if (event) {
              events.push(event);
              if (event.type === BRAIN_EVENTS.WEBHOOK) {
                foundWebhookEvent = true;
                reader.cancel();
                break;
              }
            }
          }
        }
      }

      // Step 3: Verify we got the WEBHOOK event and brain paused
      expect(foundWebhookEvent).toBe(true);
      const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
      expect(webhookEvent).toBeDefined();
      expect(webhookEvent?.waitFor).toBeDefined();
      expect(webhookEvent?.waitFor.length).toBeGreaterThan(0);

      // Should NOT have a COMPLETE event yet
      const prematureComplete = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(prematureComplete).toBeUndefined();

      await waitOnExecutionContext(watchContext);

      // Step 4: Trigger the webhook with matching identifier
      const webhookRequest = new Request(
        'http://example.com/webhooks/test-webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'Response from webhook',
            user: 'test-user-456',
            threadId: webhookIdentifier,
          }),
        }
      );
      const webhookContext = createExecutionContext();
      const webhookResponse = await worker.fetch(
        webhookRequest,
        testEnv,
        webhookContext
      );

      expect(webhookResponse.status).toBe(200);
      const webhookResult = await webhookResponse.json<{
        received: boolean;
        action: string;
        identifier?: string;
      }>();
      expect(webhookResult.received).toBe(true);
      expect(webhookResult.action).toBe('resumed'); // Should resume the waiting brain
      await waitOnExecutionContext(webhookContext);

      // Step 5: Watch the brain again - it should now complete
      const resumeWatchRequest = new Request(watchUrl);
      const resumeWatchContext = createExecutionContext();
      const resumeWatchResponse = await worker.fetch(
        resumeWatchRequest,
        testEnv,
        resumeWatchContext
      );

      if (!resumeWatchResponse.body) {
        throw new Error('Resume watch response body is null');
      }

      const resumeEvents = await readSseStream(resumeWatchResponse.body);
      await waitOnExecutionContext(resumeWatchContext);

      // Step 6: Verify brain completed with webhook response data
      const completeEvent = resumeEvents.find(
        (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe(STATUS.COMPLETE);

      // Verify the final step processed the webhook response
      const finalStepComplete = resumeEvents.find(
        (e): e is StepCompletedEvent =>
          e.type === BRAIN_EVENTS.STEP_COMPLETE &&
          e.stepTitle === 'Process response'
      );
      expect(finalStepComplete).toBeDefined();

      // Check that the patch includes the webhook response data
      const patch = finalStepComplete?.patch;
      expect(patch).toBeDefined();
      const receivedMessageOp = patch?.find(
        (op) => op.op === 'add' && op.path === '/receivedMessage'
      );
      expect(receivedMessageOp?.value).toBe('Response from webhook');

      const receivedUserIdOp = patch?.find(
        (op) => op.op === 'add' && op.path === '/receivedUserId'
      );
      expect(receivedUserIdOp?.value).toBe('test-user-456');
    });

    it('should handle webhook verification challenge', async () => {
      const testEnv = env as TestEnv;
      const challengeString = 'verification-challenge-xyz123';

      // Send a verification request to the webhook endpoint
      const webhookRequest = new Request(
        'http://example.com/webhooks/test-webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'url_verification',
            challenge: challengeString,
          }),
        }
      );
      const webhookContext = createExecutionContext();
      const webhookResponse = await worker.fetch(
        webhookRequest,
        testEnv,
        webhookContext
      );

      expect(webhookResponse.status).toBe(200);
      const result = await webhookResponse.json<{ challenge: string }>();
      expect(result.challenge).toBe(challengeString);
      await waitOnExecutionContext(webhookContext);
    });

    it('should resume inner brain when webhook is received', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'inner-webhook-brain';
      const webhookIdentifier = 'inner-test-id';

      // Step 1: Start the inner-webhook-brain (outer brain with inner brain that has webhook)
      const createRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      expect(createResponse.status).toBe(201);
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Step 2: Watch the brain - it should pause with WEBHOOK event from inner brain
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      expect(watchResponse.status).toBe(200);
      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      // Read events until we get the WEBHOOK event (inner brain pauses)
      const reader = watchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const events: BrainEvent[] = [];
      let foundWebhookEvent = false;

      while (!foundWebhookEvent) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.substring(0, eventEndIndex);
          buffer = buffer.substring(eventEndIndex + 2);

          if (message.startsWith('data:')) {
            const event = parseSseEvent(message);
            if (event) {
              events.push(event);
              if (event.type === BRAIN_EVENTS.WEBHOOK) {
                foundWebhookEvent = true;
                reader.cancel();
                break;
              }
            }
          }
        }
      }

      // Step 3: Verify we got the WEBHOOK event and brain paused
      expect(foundWebhookEvent).toBe(true);
      const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
      expect(webhookEvent).toBeDefined();

      // Verify all events have the same brainRunId (inner brain should share outer brain's brainRunId)
      const uniqueBrainRunIds = [...new Set(events.map((e) => e.brainRunId))];
      expect(uniqueBrainRunIds).toEqual([brainRunId]);

      // Should NOT have outer brain COMPLETE event yet
      const prematureOuterComplete = events.find(
        (e) =>
          e.type === BRAIN_EVENTS.COMPLETE &&
          'brainTitle' in e &&
          e.brainTitle === 'inner-webhook-brain'
      );
      expect(prematureOuterComplete).toBeUndefined();

      await waitOnExecutionContext(watchContext);

      // Step 4: Trigger the inner webhook with matching identifier
      const webhookRequest = new Request(
        'http://example.com/webhooks/inner-webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: webhookIdentifier,
            data: 'Inner webhook response data',
          }),
        }
      );
      const webhookHttpContext = createExecutionContext();
      const webhookResponse = await worker.fetch(
        webhookRequest,
        testEnv,
        webhookHttpContext
      );

      expect(webhookResponse.status).toBe(200);
      const webhookResult = await webhookResponse.json<{
        received: boolean;
        action: string;
      }>();
      expect(webhookResult.received).toBe(true);
      expect(webhookResult.action).toBe('resumed');
      await waitOnExecutionContext(webhookHttpContext);

      // Step 5: Watch the brain again - it should now complete
      const resumeWatchRequest = new Request(watchUrl);
      const resumeWatchContext = createExecutionContext();
      const resumeWatchResponse = await worker.fetch(
        resumeWatchRequest,
        testEnv,
        resumeWatchContext
      );

      if (!resumeWatchResponse.body) {
        throw new Error('Resume watch response body is null');
      }

      const resumeEvents = await readSseStream(resumeWatchResponse.body);
      await waitOnExecutionContext(resumeWatchContext);

      // Step 6: Verify inner brain processed the webhook
      const innerProcessStep = resumeEvents.find(
        (e): e is StepCompletedEvent =>
          e.type === BRAIN_EVENTS.STEP_COMPLETE &&
          e.stepTitle === 'Process inner webhook'
      );
      expect(innerProcessStep).toBeDefined();

      // Verify the patch includes the webhook response data
      const innerPatch = innerProcessStep?.patch;
      expect(innerPatch).toBeDefined();
      const webhookDataOp = innerPatch?.find(
        (op) => op.op === 'add' && op.path === '/webhookData'
      );
      expect(webhookDataOp?.value).toBe('Inner webhook response data');

      // Step 7: Verify outer brain completed after inner brain
      const outerStep2 = resumeEvents.find(
        (e): e is StepCompletedEvent =>
          e.type === BRAIN_EVENTS.STEP_COMPLETE &&
          e.stepTitle === 'Outer step 2'
      );
      expect(outerStep2).toBeDefined();

      const outerCompleteEvent = resumeEvents.find(
        (e): e is BrainCompleteEvent =>
          e.type === BRAIN_EVENTS.COMPLETE &&
          e.brainTitle === 'inner-webhook-brain'
      );
      expect(outerCompleteEvent).toBeDefined();
      expect(outerCompleteEvent?.status).toBe(STATUS.COMPLETE);
    });
  });

  describe('Loop Webhook Resumption', () => {
    it('should pause loop on webhook and resume with restored context', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'loop-webhook-brain';
      const webhookIdentifier = 'test-escalation-123';

      // Step 1: Start the loop-webhook-brain
      const createRequest = new Request('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      expect(createResponse.status).toBe(201);
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Step 2: Watch the brain - it should pause with LOOP_WEBHOOK and WEBHOOK events
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      expect(watchResponse.status).toBe(200);
      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      // Read events until we get the WEBHOOK event (brain pauses)
      const reader = watchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const events: BrainEvent[] = [];
      let foundWebhookEvent = false;

      while (!foundWebhookEvent) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const message = buffer.substring(0, eventEndIndex);
          buffer = buffer.substring(eventEndIndex + 2);

          if (message.startsWith('data:')) {
            const event = parseSseEvent(message);
            if (event) {
              events.push(event);
              if (event.type === BRAIN_EVENTS.WEBHOOK) {
                foundWebhookEvent = true;
                reader.cancel();
                break;
              }
            }
          }
        }
      }

      // Step 3: Verify loop-specific events were emitted
      expect(foundWebhookEvent).toBe(true);

      // Should have LOOP_START with prompt
      const loopStartEvent = events.find(
        (e): e is LoopStartEvent<any> => e.type === BRAIN_EVENTS.LOOP_START
      );
      expect(loopStartEvent).toBeDefined();
      expect(loopStartEvent?.prompt).toBe(
        'Please process this request. If you need human review, use the escalate tool.'
      );
      expect(loopStartEvent?.system).toBe(
        'You are an AI assistant that can escalate to humans when needed.'
      );

      // Should have LOOP_TOOL_CALL for the escalate tool
      const loopToolCallEvent = events.find(
        (e): e is LoopToolCallEvent<any> =>
          e.type === BRAIN_EVENTS.LOOP_TOOL_CALL && e.toolName === 'escalate'
      );
      expect(loopToolCallEvent).toBeDefined();
      expect(loopToolCallEvent?.toolName).toBe('escalate');

      // Should have LOOP_WEBHOOK before WEBHOOK
      const loopWebhookEvent = events.find(
        (e): e is LoopWebhookEvent<any> => e.type === BRAIN_EVENTS.LOOP_WEBHOOK
      );
      expect(loopWebhookEvent).toBeDefined();
      expect(loopWebhookEvent?.toolName).toBe('escalate');
      expect(loopWebhookEvent?.toolCallId).toBeDefined();

      // Should NOT have COMPLETE yet
      const prematureComplete = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(prematureComplete).toBeUndefined();

      await waitOnExecutionContext(watchContext);

      // Step 4: Trigger the webhook with matching identifier
      const webhookRequest = new Request(
        'http://example.com/webhooks/loop-escalation',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            escalationId: webhookIdentifier,
            approved: true,
            note: 'Approved by human reviewer',
          }),
        }
      );
      const webhookContext = createExecutionContext();
      const webhookResponse = await worker.fetch(
        webhookRequest,
        testEnv,
        webhookContext
      );

      expect(webhookResponse.status).toBe(200);
      const webhookResult = await webhookResponse.json<{
        received: boolean;
        action: string;
        identifier?: string;
      }>();
      expect(webhookResult.received).toBe(true);
      expect(webhookResult.action).toBe('resumed');
      await waitOnExecutionContext(webhookContext);

      // Step 5: Watch the brain again - it should resume and complete
      const resumeWatchRequest = new Request(watchUrl);
      const resumeWatchContext = createExecutionContext();
      const resumeWatchResponse = await worker.fetch(
        resumeWatchRequest,
        testEnv,
        resumeWatchContext
      );

      if (!resumeWatchResponse.body) {
        throw new Error('Resume watch response body is null');
      }

      const resumeEvents = await readSseStream(resumeWatchResponse.body);
      await waitOnExecutionContext(resumeWatchContext);

      // Step 6: Verify resumed events
      // Should have WEBHOOK_RESPONSE event
      const webhookResponseEvent = resumeEvents.find(
        (e): e is WebhookResponseEvent<any> =>
          e.type === BRAIN_EVENTS.WEBHOOK_RESPONSE
      );
      expect(webhookResponseEvent).toBeDefined();
      expect(webhookResponseEvent?.response).toEqual({
        approved: true,
        reviewerNote: 'Approved by human reviewer',
      });

      // Should have LOOP_TOOL_RESULT with the webhook response
      const loopToolResultEvent = resumeEvents.find(
        (e): e is LoopToolResultEvent<any> =>
          e.type === BRAIN_EVENTS.LOOP_TOOL_RESULT &&
          e.toolName === 'escalate'
      );
      expect(loopToolResultEvent).toBeDefined();
      expect(loopToolResultEvent?.result).toEqual({
        approved: true,
        reviewerNote: 'Approved by human reviewer',
      });

      // Should have LOOP_COMPLETE
      const loopCompleteEvent = resumeEvents.find(
        (e): e is LoopCompleteEvent<any> => e.type === BRAIN_EVENTS.LOOP_COMPLETE
      );
      expect(loopCompleteEvent).toBeDefined();

      // Should have BRAIN COMPLETE
      const completeEvent = resumeEvents.find(
        (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.status).toBe(STATUS.COMPLETE);
    });
  });

});
