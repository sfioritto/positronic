import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, STATUS, createBrainExecutionMachine, sendEvent } from '@positronic/core';
import { resetMockState } from '../src/runner';
import type {
  BrainEvent,
  BrainStartEvent,
  BrainCompleteEvent,
  StepCompletedEvent,
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

// NOTE: These tests are skipped due to vitest-pool-workers limitations with
// large data and async Durable Object storage operations. The isolated storage
// cleanup fails when SQLite contains large blob data. The R2 overflow functionality
// is implemented and can be tested manually or in production environments.
// See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
describe.skip('R2 Overflow Storage Tests', () => {
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
          console.error('[TEST_SSE_PARSE] Failed to parse SSE data:', line.substring(6), e);
          return null;
        }
      }
    }
    return null;
  }

  // Helper function to read the entire SSE stream and collect events
  async function readSseStream(
    stream: ReadableStream<Uint8Array>
  ): Promise<BrainEvent[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: BrainEvent[] = [];
    const machine = createBrainExecutionMachine();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.trim().length > 0) {
          const event = parseSseEvent(buffer);
          if (event) {
            events.push(event);
            sendEvent(machine, event);
          }
        }
        break;
      }

      const decodedChunk = decoder.decode(value, { stream: true });
      buffer += decodedChunk;
      let eventEndIndex;
      while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
        const message = buffer.substring(0, eventEndIndex);
        buffer = buffer.substring(eventEndIndex + 2);
        if (message.startsWith('data:')) {
          const event = parseSseEvent(message);
          if (event) {
            events.push(event);
            sendEvent(machine, event);

            if (machine.context.isComplete) {
              reader.cancel('Brain completed');
              return events;
            }

            if (machine.context.isError) {
              console.error('Received BRAIN_EVENTS.ERROR. Event details:', event);
              reader.cancel('Brain errored');
              throw new Error(`Brain errored. Details: ${JSON.stringify(event)}`);
            }
          }
        }
      }
    }
    return events;
  }

  it('should overflow large events to R2 and complete successfully', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'large-state-brain';

    // Start the brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createContext);
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    // Watch the brain run via SSE until completion
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

    expect(watchResponse.status).toBe(200);
    if (!watchResponse.body) {
      throw new Error('Watch response body is null');
    }

    const allEvents = await readSseStream(watchResponse.body);
    await waitOnExecutionContext(watchContext);

    // Verify brain completed successfully
    const completeEvent = allEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Verify the large state step completed
    const largeStateStep = allEvents.find(
      (e): e is StepCompletedEvent =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE && e.stepTitle === 'Generate large state'
    );
    expect(largeStateStep).toBeDefined();

    // R2 objects persist after brain completion for debugging/auditing purposes.
  });

  it('should resume brain with R2-stored events correctly', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'large-state-webhook-brain';
    const webhookIdentifier = 'large-state-test';

    // Step 1: Start the brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: brainName }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createContext);
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    // Step 2: Watch the brain - it should pause with WEBHOOK event after generating large state
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = new Request(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);

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

    expect(foundWebhookEvent).toBe(true);
    await waitOnExecutionContext(watchContext);

    // Verify R2 has overflow objects for the large state
    const r2ListBeforeResume = await testEnv.RESOURCES_BUCKET.list({ prefix: `events/${brainRunId}/` });
    expect(r2ListBeforeResume.objects.length).toBeGreaterThan(0);

    // Step 3: Trigger the webhook to resume
    const webhookRequest = new Request('http://example.com/webhooks/test-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Webhook response after large state',
        user: 'test-user',
        threadId: webhookIdentifier,
      }),
    });
    const webhookContext = createExecutionContext();
    const webhookResponse = await worker.fetch(webhookRequest, testEnv, webhookContext);

    expect(webhookResponse.status).toBe(200);
    const webhookResult = await webhookResponse.json<{ received: boolean; action: string }>();
    expect(webhookResult.received).toBe(true);
    expect(webhookResult.action).toBe('resumed');
    await waitOnExecutionContext(webhookContext);

    // Step 4: Watch the brain again - it should complete
    const resumeWatchRequest = new Request(watchUrl);
    const resumeWatchContext = createExecutionContext();
    const resumeWatchResponse = await worker.fetch(resumeWatchRequest, testEnv, resumeWatchContext);

    if (!resumeWatchResponse.body) {
      throw new Error('Resume watch response body is null');
    }

    const resumeEvents = await readSseStream(resumeWatchResponse.body);
    await waitOnExecutionContext(resumeWatchContext);

    // Verify brain completed
    const completeEvent = resumeEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Verify the final step processed the webhook response
    const afterWebhookStep = resumeEvents.find(
      (e): e is StepCompletedEvent =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE && e.stepTitle === 'After webhook'
    );
    expect(afterWebhookStep).toBeDefined();
  });
});
