import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import { resetMockState, setMockError } from '../src/runner';
import type {
  BrainEvent,
  BrainStartEvent,
  BrainErrorEvent,
  StepStatusEvent,
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

/**
 * Creates an error object that simulates what the Anthropic API returns
 * for a "request too large" error (too many tokens).
 *
 * Based on Anthropic's documented error format:
 * {
 *   "type": "error",
 *   "error": {
 *     "type": "request_too_large",
 *     "message": "Request exceeds the maximum allowed number of bytes."
 *   },
 *   "request_id": "req_xxx"
 * }
 */
function createAnthropicTooManyTokensError(): Error {
  const error = new Error(
    'Request exceeds the maximum allowed number of bytes. The maximum request size is 32 MB for standard API endpoints.'
  );
  error.name = 'AnthropicAPIError';
  // Add properties that the Anthropic SDK would add
  (error as any).status = 413;
  (error as any).error = {
    type: 'request_too_large',
    message:
      'Request exceeds the maximum allowed number of bytes. The maximum request size is 32 MB for standard API endpoints.',
  };
  return error;
}

describe('Brain API Error Handling', () => {
  beforeEach(() => {
    resetMockState();
  });

  // Helper to parse SSE data field
  function parseSseEvent(text: string): any | null {
    const lines = text.trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const jsonData = line.substring(6);
          const parsed = JSON.parse(jsonData);
          return parsed;
        } catch (e) {
          console.error('[TEST_SSE_PARSE] Failed to parse SSE data:', e);
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Read SSE stream and collect all events, including ERROR events.
   * Unlike the standard readSseStream helper, this one doesn't throw on ERROR.
   * It also waits for one more event after ERROR to capture the final STEP_STATUS.
   */
  async function readSseStreamIncludingErrors(
    stream: ReadableStream<Uint8Array>
  ): Promise<BrainEvent[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: BrainEvent[] = [];
    let sawTerminalEvent = false;
    let eventsAfterTerminal = 0;

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
        break;
      }

      const decodedChunk = decoder.decode(value, { stream: true });
      buffer += decodedChunk;

      // Process buffer line by line, looking for complete messages (ending in \n\n)
      let eventEndIndex;
      while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
        const message = buffer.substring(0, eventEndIndex);
        buffer = buffer.substring(eventEndIndex + 2);
        if (message.startsWith('data:')) {
          const event = parseSseEvent(message);
          if (event) {
            events.push(event);

            // Mark when we see terminal events
            if (
              event.type === BRAIN_EVENTS.COMPLETE ||
              event.type === BRAIN_EVENTS.ERROR
            ) {
              sawTerminalEvent = true;
            }

            // After terminal event, wait for one more event (the final STEP_STATUS)
            // then stop reading
            if (sawTerminalEvent) {
              eventsAfterTerminal++;
              // The brain emits STEP_STATUS after ERROR, so wait for it
              if (
                eventsAfterTerminal > 1 ||
                event.type === BRAIN_EVENTS.STEP_STATUS
              ) {
                reader.cancel('Received final events after terminal');
                return events;
              }
            }
          }
        }
      }
    }
    return events;
  }

  /**
   * DESIGN DOCUMENTATION: Fire-and-forget pattern
   *
   * The brain-runner-do.ts intentionally does NOT await the brain run:
   *
   *   runnerWithResources
   *     .withAdapters([...])
   *     .run(brainToRun, {...})  // NOT awaited!
   *     .catch((err) => { console.error(...); throw err; })
   *
   * This is intentional because:
   * 1. Long-running brains would timeout HTTP requests if awaited
   * 2. The SSE streaming pattern is the expected way to monitor completion
   * 3. POST /brains/runs returns immediately with brainRunId for the client
   *
   * Consequences:
   * - If you query history immediately after POST (without watching SSE),
   *   you may see "running" even if the brain has already completed or errored
   * - This is NOT a bug - it's the expected behavior for fire-and-forget
   * - The SSE stream is the authoritative way to know when a brain completes
   *
   * The tests below verify:
   * - Fire-and-forget applies to BOTH successful and error cases
   * - When SSE is watched, history is accurate after the stream ends
   */
  describe('Fire-and-forget pattern (design verification)', () => {
    it('successful brain shows "running" without SSE watching (expected behavior)', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'basic-brain';

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

      const history = await historyResponse.json<{
        runs: Array<{ brainRunId: string; status: string }>;
      }>();
      const ourRun = history.runs.find((r) => r.brainRunId === brainRunId);

      // This is EXPECTED - fire-and-forget means brain hasn't finished yet
      expect(ourRun?.status).toBe(STATUS.RUNNING);
    });

    it('errored brain shows "running" without SSE watching (expected behavior)', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'agent-error-brain';

      setMockError(createAnthropicTooManyTokensError());

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

      const history = await historyResponse.json<{
        runs: Array<{ brainRunId: string; status: string }>;
      }>();
      const ourRun = history.runs.find((r) => r.brainRunId === brainRunId);

      // This is EXPECTED - fire-and-forget means brain hasn't finished erroring yet
      expect(ourRun?.status).toBe(STATUS.RUNNING);
    });
  });

  describe('API Error in Agent Step (simulating Anthropic "too many tokens")', () => {
    /**
     * NOTE: The tests that watch SSE verify the CORRECT behavior.
     * The fire-and-forget tests above verify the EXPECTED race condition.
     *
     * When SSE is watched:
     * - ERROR event is received
     * - History shows "error" status
     * - Step status shows "error"
     *
     * When SSE is NOT watched (fire-and-forget):
     * - History may show "running" if queried before brain completes
     * - This is expected behavior, not a bug
     */

    it('should emit ERROR event and update history status to ERROR when API call fails', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'agent-error-brain';

      // Configure the mock client to throw an Anthropic-like error
      setMockError(createAnthropicTooManyTokensError());

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
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Watch the brain run via SSE - this should receive the ERROR event
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

      // Read all events including the ERROR event
      const allEvents = await readSseStreamIncludingErrors(watchResponse.body);
      await waitOnExecutionContext(watchContext);

      // --- Verify the ERROR event was emitted ---
      const errorEvent = allEvents.find(
        (e): e is BrainErrorEvent => e.type === BRAIN_EVENTS.ERROR
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.status).toBe(STATUS.ERROR);
      expect(errorEvent?.error).toBeDefined();
      expect(errorEvent?.error?.message).toContain(
        'Request exceeds the maximum allowed number of bytes'
      );

      // Verify start event was emitted before the error
      const startEvent = allEvents.find(
        (e): e is BrainStartEvent => e.type === BRAIN_EVENTS.START
      );
      expect(startEvent).toBeDefined();
      expect(startEvent?.status).toBe(STATUS.RUNNING);

      // --- Verify history shows ERROR status, not RUNNING ---
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
          status: string;
          error: { name: string; message: string; stack?: string } | null;
          completedAt: number | null;
        }>;
      }>();

      // Find our run in the history
      const ourRun = history.runs.find((r) => r.brainRunId === brainRunId);
      expect(ourRun).toBeDefined();

      // THIS IS THE KEY ASSERTION: status should be ERROR, not RUNNING
      expect(ourRun?.status).toBe(STATUS.ERROR);
      expect(ourRun?.error).toBeDefined();
      // The error might be a string or an object depending on how it was serialized
      const errorMessage =
        typeof ourRun?.error === 'string'
          ? ourRun.error
          : ourRun?.error?.message;
      expect(errorMessage).toContain(
        'Request exceeds the maximum allowed number of bytes'
      );
      // completedAt should be set since the brain has terminated
      expect(ourRun?.completedAt).toBeDefined();
      expect(ourRun?.completedAt).not.toBeNull();
    });

    it('should show correct step status when error occurs in agent step', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'agent-error-brain';

      // Configure the mock client to throw an error
      setMockError(createAnthropicTooManyTokensError());

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
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Watch the brain run
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      const allEvents = await readSseStreamIncludingErrors(watchResponse.body);
      await waitOnExecutionContext(watchContext);

      // Find the final step status event
      const stepStatusEvents = allEvents.filter(
        (e): e is StepStatusEvent => e.type === BRAIN_EVENTS.STEP_STATUS
      );
      expect(stepStatusEvents.length).toBeGreaterThan(0);
      const lastStepStatusEvent = stepStatusEvents[stepStatusEvents.length - 1];

      // The loop step that errored should have ERROR status
      const errorStep = lastStepStatusEvent.steps.find(
        (step: any) => step.status === STATUS.ERROR
      );
      expect(errorStep).toBeDefined();
      expect(errorStep?.title).toBe('Process request');
    });

    it('should clean up webhook registrations when brain errors', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'agent-error-brain';

      // Configure the mock client to throw an error
      setMockError(createAnthropicTooManyTokensError());

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
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Watch until error
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      await readSseStreamIncludingErrors(watchResponse.body);
      await waitOnExecutionContext(watchContext);

      // Get the monitor singleton
      const monitorId = testEnv.MONITOR_DO.idFromName('singleton');
      const monitorStub = testEnv.MONITOR_DO.get(monitorId);

      // Verify the brain run is marked as errored in the monitor
      const lastEvent = await monitorStub.getLastEvent(brainRunId);
      expect(lastEvent).toBeDefined();
      expect((lastEvent as any).status).toBe(STATUS.ERROR);
    });

    it('should not show errored brain in running brains list', async () => {
      const testEnv = env as TestEnv;
      const brainName = 'agent-error-brain';

      // Configure the mock client to throw an error
      setMockError(createAnthropicTooManyTokensError());

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
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Watch until error
      const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
      const watchRequest = new Request(watchUrl);
      const watchContext = createExecutionContext();
      const watchResponse = await worker.fetch(
        watchRequest,
        testEnv,
        watchContext
      );

      if (!watchResponse.body) {
        throw new Error('Watch response body is null');
      }

      await readSseStreamIncludingErrors(watchResponse.body);
      await waitOnExecutionContext(watchContext);

      // Connect to watch endpoint for running brains
      const runningBrainsRequest = new Request('http://example.com/brains/watch');
      const runningBrainsContext = createExecutionContext();
      const runningBrainsResponse = await worker.fetch(
        runningBrainsRequest,
        testEnv,
        runningBrainsContext
      );

      expect(runningBrainsResponse.status).toBe(200);
      if (!runningBrainsResponse.body) {
        throw new Error('Running brains response body is null');
      }

      // Read the first event from the running brains stream
      const reader = runningBrainsResponse.body.getReader();
      const { value } = await reader.read();
      reader.cancel();

      const decoder = new TextDecoder();
      const chunk = decoder.decode(value);
      const event = parseSseEvent(chunk);

      // The errored brain should NOT appear in the running brains list
      const runningBrains = event?.runningBrains || [];
      const erroredBrain = runningBrains.find(
        (b: any) => b.brainRunId === brainRunId
      );
      expect(erroredBrain).toBeUndefined();

      await waitOnExecutionContext(runningBrainsContext);
    });
  });
});
