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

function getGovernorStub(testEnv: TestEnv, identity = 'test-identity') {
  const id = testEnv.GOVERNOR_DO.idFromName(identity);
  return testEnv.GOVERNOR_DO.get(id);
}

describe('GovernorDO Integration Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('should admit immediately for unknown model (no limits)', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv, 'unknown-model-identity');

    // waitForCapacity should resolve immediately for an unknown model
    await stub.waitForCapacity('unknown-model', 100);
  });

  it('should seed Google defaults and throttle', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv, 'google-identity');

    // First call seeds limits from Google defaults and resolves
    await stub.waitForCapacity('gemini-2.5-flash-lite', 100);
  });

  it('should update limits from reportHeaders', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv, 'header-update-identity');

    // Report headers with Anthropic-style limits, then verify
    // waitForCapacity uses the limits by resolving (not hanging forever)
    await stub.reportHeaders({
      'anthropic-ratelimit-requests-limit': '100',
      'anthropic-ratelimit-tokens-limit': '500000',
    });

    await stub.waitForCapacity('some-model', 100);
  });

  it('should update limits from OpenAI-style headers', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv, 'openai-identity');

    await stub.reportHeaders({
      'x-ratelimit-limit-requests': '200',
      'x-ratelimit-limit-tokens': '1000000',
    });

    await stub.waitForCapacity('some-model', 100);
  });

  it('should process multiple concurrent requests in order', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv, 'concurrent-identity');

    // Seed limits first (high RPM so delays are very small)
    await stub.reportHeaders({
      'x-ratelimit-limit-requests': '10000',
      'x-ratelimit-limit-tokens': '10000000',
    });

    // Fire multiple concurrent waitForCapacity calls
    const order: number[] = [];
    const promises = [1, 2, 3, 4, 5].map((i) =>
      stub.waitForCapacity('test-model', 100).then(() => {
        order.push(i);
      })
    );

    await Promise.all(promises);

    // All should have resolved
    expect(order).toHaveLength(5);
    // Should be FIFO ordered
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('should complete brain execution through governor', async () => {
    const testEnv = env as TestEnv;

    // Create a brain run that uses a prompt step (exercises rateGoverned wrapper)
    const request = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'governor-test-brain' }),
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    expect(response.status).toBe(201);
    const { brainRunId } = await response.json<{ brainRunId: string }>();
    await waitOnExecutionContext(context);

    // Watch for completion
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );
    expect(watchResponse.status).toBe(200);
    if (!watchResponse.body) throw new Error('Watch response body is null');

    const allEvents = await readSseStream(watchResponse.body);
    await waitOnExecutionContext(watchContext);

    // Verify brain completed
    const completeEvent = allEvents.find(
      (e) => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
  });

  it('should ignore reportHeaders with unrecognized headers', async () => {
    const testEnv = env as TestEnv;
    const stub = getGovernorStub(testEnv, 'noop-headers-identity');

    await stub.reportHeaders({
      'content-type': 'application/json',
      'x-request-id': 'abc123',
    });

    // Unknown model + no limits seeded = should resolve immediately
    await stub.waitForCapacity('unknown-model', 100);
  });
});
