import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import { resetMockState } from '../src/runner';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readUntilEvent } from './sse-helpers';
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

describe('Wait Timeout Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('should cancel brain when wait timeout fires', async () => {
    const testEnv = env as TestEnv;

    // Step 1: Start the timeout-webhook-brain
    const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: 'timeout-webhook-brain' }),
    });
    const createCtx = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createCtx);
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createCtx);

    // Step 2: Watch until WEBHOOK event (brain is suspended waiting)
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchCtx = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchCtx);
    expect(watchResponse.status).toBe(200);

    const { events, found: foundWebhook } = await readUntilEvent(
      watchResponse.body!,
      BRAIN_EVENTS.WEBHOOK
    );
    expect(foundWebhook).toBe(true);
    await waitOnExecutionContext(watchCtx);

    // Verify the webhook event includes a timeout
    const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
    expect(webhookEvent).toBeDefined();
    expect((webhookEvent as any).timeout).toBeDefined();

    // Step 3: Simulate timeout: queue KILL signal and wake up the brain.
    // This replicates what alarm() does when a wait timeout expires.
    const doId = testEnv.BRAIN_RUNNER_DO.idFromName(brainRunId);
    const stub = testEnv.BRAIN_RUNNER_DO.get(doId);
    await stub.queueSignal({ type: 'KILL' });
    await stub.wakeUp(brainRunId);

    // Step 4: Watch again — should see CANCELLED event
    const resumeWatchRequest = await createAuthenticatedRequest(watchUrl);
    const resumeWatchCtx = createExecutionContext();
    const resumeWatchResponse = await worker.fetch(resumeWatchRequest, testEnv, resumeWatchCtx);

    const { found: foundCancelled } = await readUntilEvent(
      resumeWatchResponse.body!,
      BRAIN_EVENTS.CANCELLED
    );
    expect(foundCancelled).toBe(true);
    await waitOnExecutionContext(resumeWatchCtx);

    // Step 5: Verify MonitorDO status is cancelled
    const monitorId = testEnv.MONITOR_DO.idFromName('singleton');
    const monitorStub = testEnv.MONITOR_DO.get(monitorId);
    const lastEvent = await monitorStub.getLastEvent(brainRunId);
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.type).toBe(BRAIN_EVENTS.CANCELLED);
    expect(lastEvent?.status).toBe(STATUS.CANCELLED);
  });

  it('should complete normally when webhook arrives before timeout', async () => {
    const testEnv = env as TestEnv;
    const webhookIdentifier = 'timeout-test-123';

    // Step 1: Start the timeout-webhook-brain
    const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: 'timeout-webhook-brain' }),
    });
    const createCtx = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createCtx);
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createCtx);

    // Step 2: Watch until WEBHOOK event
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchCtx = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchCtx);
    expect(watchResponse.status).toBe(200);

    await readUntilEvent(watchResponse.body!, BRAIN_EVENTS.WEBHOOK);
    await waitOnExecutionContext(watchCtx);

    // Step 3: Send webhook response (before timeout fires)
    const webhookRequest = await createAuthenticatedRequest(
      'http://example.com/webhooks/test-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Response before timeout',
          user: 'test-user',
          threadId: webhookIdentifier,
        }),
      }
    );
    const webhookCtx = createExecutionContext();
    const webhookResponse = await worker.fetch(webhookRequest, testEnv, webhookCtx);
    expect(webhookResponse.status).toBe(200);
    const webhookResult = await webhookResponse.json<{ received: boolean; action: string }>();
    expect(webhookResult.received).toBe(true);
    expect(webhookResult.action).toBe('resumed');
    await waitOnExecutionContext(webhookCtx);

    // Step 4: Watch again — should see COMPLETE event
    const resumeWatchRequest = await createAuthenticatedRequest(watchUrl);
    const resumeWatchCtx = createExecutionContext();
    const resumeWatchResponse = await worker.fetch(resumeWatchRequest, testEnv, resumeWatchCtx);

    const { events: resumeEvents, found: foundComplete } = await readUntilEvent(
      resumeWatchResponse.body!,
      BRAIN_EVENTS.COMPLETE
    );
    expect(foundComplete).toBe(true);
    await waitOnExecutionContext(resumeWatchCtx);

    // Verify completion status
    const completeEvent = resumeEvents.find((e) => e.type === BRAIN_EVENTS.COMPLETE);
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Step 5: Verify MonitorDO shows complete
    const monitorId = testEnv.MONITOR_DO.idFromName('singleton');
    const monitorStub = testEnv.MONITOR_DO.get(monitorId);
    const lastEvent = await monitorStub.getLastEvent(brainRunId);
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.type).toBe(BRAIN_EVENTS.COMPLETE);
    expect(lastEvent?.status).toBe(STATUS.COMPLETE);
  });

  it('should clean up timeout alarm when brain is manually killed', async () => {
    const testEnv = env as TestEnv;

    // Step 1: Start the timeout-webhook-brain
    const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: 'timeout-webhook-brain' }),
    });
    const createCtx = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createCtx);
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createCtx);

    // Step 2: Watch until WEBHOOK event
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchCtx = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchCtx);
    expect(watchResponse.status).toBe(200);

    await readUntilEvent(watchResponse.body!, BRAIN_EVENTS.WEBHOOK);
    await waitOnExecutionContext(watchCtx);

    // Step 3: Kill the brain via DELETE
    const killRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`,
      { method: 'DELETE' }
    );
    const killCtx = createExecutionContext();
    const killResponse = await worker.fetch(killRequest, testEnv, killCtx);
    await waitOnExecutionContext(killCtx);
    expect(killResponse.status).toBe(204);

    // Step 4: Verify status is CANCELLED
    const getRunRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`
    );
    const getRunCtx = createExecutionContext();
    const getRunResponse = await worker.fetch(getRunRequest, testEnv, getRunCtx);
    await waitOnExecutionContext(getRunCtx);
    expect(getRunResponse.ok).toBe(true);

    const runData = await getRunResponse.json<{ status: string }>();
    expect(runData.status).toBe(STATUS.CANCELLED);

    // Step 5: Verify the timeout was cleaned up by kill()
    // The kill() method clears the wait timeout and deletes the alarm.
    // We verify this by checking getWaitTimeout() returns null.
    const doId = testEnv.BRAIN_RUNNER_DO.idFromName(brainRunId);
    const stub = testEnv.BRAIN_RUNNER_DO.get(doId);
    const pendingTimeout = await stub.getWaitTimeout();
    expect(pendingTimeout).toBeNull();

    // Verify MonitorDO shows cancelled
    const monitorId = testEnv.MONITOR_DO.idFromName('singleton');
    const monitorStub = testEnv.MONITOR_DO.get(monitorId);
    const lastEvent = await monitorStub.getLastEvent(brainRunId);
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.status).toBe(STATUS.CANCELLED);
  });

  it('should handle sequential waits with timeouts', async () => {
    const testEnv = env as TestEnv;

    // Step 1: Start the multi-wait-brain
    const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: 'multi-wait-brain' }),
    });
    const createCtx = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createCtx);
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createCtx);

    // Step 2: Watch until first WEBHOOK event
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchCtx = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchCtx);
    expect(watchResponse.status).toBe(200);

    await readUntilEvent(watchResponse.body!, BRAIN_EVENTS.WEBHOOK);
    await waitOnExecutionContext(watchCtx);

    // Step 3: Send webhook response for the first wait (multi-wait-1)
    const webhook1Request = await createAuthenticatedRequest(
      'http://example.com/webhooks/test-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'First response',
          user: 'test-user',
          threadId: 'multi-wait-1',
        }),
      }
    );
    const webhook1Ctx = createExecutionContext();
    const webhook1Response = await worker.fetch(webhook1Request, testEnv, webhook1Ctx);
    expect(webhook1Response.status).toBe(200);
    const webhook1Result = await webhook1Response.json<{ received: boolean; action: string }>();
    expect(webhook1Result.received).toBe(true);
    expect(webhook1Result.action).toBe('resumed');
    await waitOnExecutionContext(webhook1Ctx);

    // Step 4: Watch until second WEBHOOK event
    const watch2Request = await createAuthenticatedRequest(watchUrl);
    const watch2Ctx = createExecutionContext();
    const watch2Response = await worker.fetch(watch2Request, testEnv, watch2Ctx);

    const { found: foundSecondWebhook } = await readUntilEvent(
      watch2Response.body!,
      BRAIN_EVENTS.WEBHOOK
    );
    expect(foundSecondWebhook).toBe(true);
    await waitOnExecutionContext(watch2Ctx);

    // Step 5: Simulate timeout: queue KILL signal and wake up the brain.
    // This replicates what alarm() does when a wait timeout expires.
    const doId = testEnv.BRAIN_RUNNER_DO.idFromName(brainRunId);
    const stub = testEnv.BRAIN_RUNNER_DO.get(doId);
    await stub.queueSignal({ type: 'KILL' });
    await stub.wakeUp(brainRunId);

    // Step 6: Watch again — should see CANCELLED event
    const watch3Request = await createAuthenticatedRequest(watchUrl);
    const watch3Ctx = createExecutionContext();
    const watch3Response = await worker.fetch(watch3Request, testEnv, watch3Ctx);

    const { found: foundCancelled } = await readUntilEvent(
      watch3Response.body!,
      BRAIN_EVENTS.CANCELLED
    );
    expect(foundCancelled).toBe(true);
    await waitOnExecutionContext(watch3Ctx);

    // Step 7: Verify MonitorDO status is cancelled
    const monitorId = testEnv.MONITOR_DO.idFromName('singleton');
    const monitorStub = testEnv.MONITOR_DO.get(monitorId);
    const lastEvent = await monitorStub.getLastEvent(brainRunId);
    expect(lastEvent).toBeDefined();
    expect(lastEvent?.type).toBe(BRAIN_EVENTS.CANCELLED);
    expect(lastEvent?.status).toBe(STATUS.CANCELLED);
  });
});
