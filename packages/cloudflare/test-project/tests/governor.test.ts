import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS } from '@positronic/core';
import { resetMockState } from '../src/runner';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readSseStream } from './sse-helpers';
import type { BrainRunnerDO } from '../../src/brain-runner-do.js';
import type { MonitorDO } from '../../src/monitor-do.js';
import type { GovernorDO } from '../../src/governor-do.js';

interface TestEnv {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  GOVERNOR_DO: DurableObjectNamespace<GovernorDO>;
  RESOURCES_BUCKET: R2Bucket;
}

function getGovernorStub(testEnv: TestEnv) {
  const id = testEnv.GOVERNOR_DO.idFromName('governor');
  return testEnv.GOVERNOR_DO.get(id);
}

describe('GovernorDO Integration Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('should track active requests during brain execution', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv);

    // Verify no active requests initially
    const initialStats = await stub.getStats();
    expect(initialStats.activeRequestCount).toBe(0);

    // Create a brain run that uses a prompt step (exercises rateGoverned wrapper)
    const request = await createAuthenticatedRequest('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle: 'governor-test-brain' }),
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    expect(response.status).toBe(201);
    const { brainRunId } = await response.json<{ brainRunId: string }>();
    await waitOnExecutionContext(context);

    // Watch for completion
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);
    expect(watchResponse.status).toBe(200);
    if (!watchResponse.body) throw new Error('Watch response body is null');

    const allEvents = await readSseStream(watchResponse.body);
    await waitOnExecutionContext(watchContext);

    // Verify brain completed
    const completeEvent = allEvents.find((e) => e.type === BRAIN_EVENTS.COMPLETE);
    expect(completeEvent).toBeDefined();

    // After completion, all leases should be released
    const finalStats = await stub.getStats();
    expect(finalStats.activeRequestCount).toBe(0);
  });

  it('should acquire and release leases via GovernorDO directly', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv);

    // Acquire a lease
    const acquireResult = await stub.acquire({
      requestId: 'test-1',
      clientIdentity: 'test-identity',
      modelId: 'test-model',
      estimatedTokens: 100,
    });
    expect(acquireResult).toEqual({ granted: true });

    // Verify active request count
    const statsAfterAcquire = await stub.getStats();
    expect(statsAfterAcquire.activeRequestCount).toBe(1);

    // Release the lease
    await stub.release({
      requestId: 'test-1',
      clientIdentity: 'test-identity',
      actualTokens: 50,
    });

    // Verify lease was released
    const statsAfterRelease = await stub.getStats();
    expect(statsAfterRelease.activeRequestCount).toBe(0);
  });

  it('should clean up stale leases', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv);

    // Acquire a lease
    await stub.acquire({
      requestId: 'stale-1',
      clientIdentity: 'test-identity',
      modelId: 'test-model',
      estimatedTokens: 100,
    });
    const statsAfter = await stub.getStats();
    expect(statsAfter.activeRequestCount).toBe(1);

    // Clean up with timeout of 0ms — all leases are immediately "stale"
    await stub.cleanupStaleLeases(0);

    const statsAfterCleanup = await stub.getStats();
    expect(statsAfterCleanup.activeRequestCount).toBe(0);
  });

  it('should seed Google model defaults from modelId', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv);

    // Acquire with a known Google model name — should seed rate limit defaults
    const result = await stub.acquire({
      requestId: 'google-1',
      clientIdentity: 'google-identity-hash',
      modelId: 'gemini-2.5-flash-lite',
      estimatedTokens: 100,
    });
    expect(result.granted).toBe(true);

    // Verify rate limits were seeded from Google defaults
    const stats = await stub.getStats();
    const entry = stats.rateLimits.find((r) => r.clientIdentity === 'google-identity-hash');
    expect(entry).toBeDefined();
    expect(entry!.rpmLimit).toBe(4000);
    expect(entry!.tpmLimit).toBe(4_000_000);
  });

  it('should enforce rate limits when RPM is exhausted', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv);

    // Seed rate limits by releasing with headers that indicate exhausted RPM
    await stub.release({
      requestId: 'seed-request',
      clientIdentity: 'limited-identity',
      actualTokens: 10,
      responseHeaders: {
        'x-ratelimit-limit-requests': '2',
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '60s',
        'x-ratelimit-limit-tokens': '10000',
        'x-ratelimit-remaining-tokens': '9000',
        'x-ratelimit-reset-tokens': '60s',
      },
    });

    // Attempt to acquire — should be denied
    const acquireResult = await stub.acquire({
      requestId: 'denied-1',
      clientIdentity: 'limited-identity',
      modelId: 'test-model',
      estimatedTokens: 100,
    });
    expect(acquireResult.granted).toBe(false);
    expect(acquireResult.retryAfterMs).toBeGreaterThan(0);
  });

  it('GET /governor/stats returns rate limit data', async () => {
    const testEnv = env as TestEnv;

    // Check stats via API — should start empty
    const statsRequest = await createAuthenticatedRequest('http://example.com/governor/stats');
    const statsContext = createExecutionContext();
    const statsResponse = await worker.fetch(statsRequest, testEnv, statsContext);
    await waitOnExecutionContext(statsContext);

    expect(statsResponse.status).toBe(200);
    const stats = await statsResponse.json<{ rateLimits: unknown[]; activeRequestCount: number }>();
    expect(stats).toHaveProperty('rateLimits');
    expect(stats).toHaveProperty('activeRequestCount');
    expect(Array.isArray(stats.rateLimits)).toBe(true);
    expect(stats.activeRequestCount).toBe(0);

    // Acquire a lease directly, then verify stats endpoint reflects it
    const stub = getGovernorStub(testEnv);
    await stub.acquire({
      requestId: 'api-test-1',
      clientIdentity: 'api-test-identity',
      modelId: 'test-model',
      estimatedTokens: 200,
    });

    const statsRequest2 = await createAuthenticatedRequest('http://example.com/governor/stats');
    const statsContext2 = createExecutionContext();
    const statsResponse2 = await worker.fetch(statsRequest2, testEnv, statsContext2);
    await waitOnExecutionContext(statsContext2);

    expect(statsResponse2.status).toBe(200);
    const stats2 = await statsResponse2.json<{ rateLimits: unknown[]; activeRequestCount: number }>();
    expect(stats2.activeRequestCount).toBe(1);
  });
});
