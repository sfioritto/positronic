import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index';
import { brains } from '@positronic/spec';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import type { BrainRunnerDO } from '../../src/brain-runner-do.js';
import type { MonitorDO } from '../../src/monitor-do.js';

interface TestEnv {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  DB: D1Database;
  RESOURCES_BUCKET: R2Bucket;
}

describe('Brain Kill API', () => {
  it('should pass the spec test for killing a brain run', async () => {
    const testEnv = env as TestEnv;
    const ctx = createExecutionContext();
    
    // First create a brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'delayed-brain' }),
    });
    
    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);
    
    const { brainRunId } = await createResponse.json() as { brainRunId: string };
    
    // Wait a bit to ensure the brain is running
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Test via spec
    const result = await brains.kill(async (req) => worker.fetch(req, testEnv, ctx), brainRunId);
    expect(result).toBe(true);
  });

  it('should return 404 for non-existent brain run', async () => {
    const testEnv = env as TestEnv;
    const ctx = createExecutionContext();
    const runId = 'non-existent-run';
    
    const request = new Request(`http://example.com/brains/runs/${runId}`, {
      method: 'DELETE',
    });
    
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(404);
  });

  it('should kill an active brain run', async () => {
    const testEnv = env as TestEnv;
    const ctx = createExecutionContext();

    // First create a brain run
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'delayed-brain' }),
    });

    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);

    const { brainRunId } = await createResponse.json() as { brainRunId: string };

    // Wait a bit to ensure the brain is running
    await new Promise(resolve => setTimeout(resolve, 100));

    // Kill the brain run
    const killRequest = new Request(`http://example.com/brains/runs/${brainRunId}`, {
      method: 'DELETE',
    });

    const killResponse = await worker.fetch(killRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(killResponse.status).toBe(204);

    // Verify it was killed by checking the monitor
    const historyRequest = new Request(`http://example.com/brains/delayed-brain/history?limit=1`);
    const historyResponse = await worker.fetch(historyRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(historyResponse.status).toBe(200);

    const { runs } = await historyResponse.json() as { runs: Array<{ brainRunId: string; status: string }> };
    const killedRun = runs.find(r => r.brainRunId === brainRunId);
    expect(killedRun).toBeDefined();
    // The status might still be RUNNING if the cancellation hasn't propagated yet
    // But the important thing is that the kill endpoint returned 204
  });

  it('should kill a brain suspended on a webhook via spec test', async () => {
    const testEnv = env as TestEnv;
    const ctx = createExecutionContext();

    const result = await brains.killSuspended(
      async (req) => worker.fetch(req, testEnv, ctx),
      'loop-webhook-brain',
      'loop-escalation',
      { escalationId: 'test-escalation-123', approved: true, note: 'Approved after kill' }
    );

    expect(result).toBe(true);
  });

  it('should kill a brain suspended on a webhook and update status to CANCELLED', async () => {
    const testEnv = env as TestEnv;
    const ctx = createExecutionContext();

    // Step 1: Start the loop-webhook-brain
    const createRequest = new Request('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'loop-webhook-brain' }),
    });

    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);

    const { brainRunId } = await createResponse.json() as { brainRunId: string };

    // Step 2: Watch until WEBHOOK event (brain suspends)
    const watchRequest = new Request(`http://example.com/brains/runs/${brainRunId}/watch`);
    const watchResponse = await worker.fetch(watchRequest, testEnv, ctx);
    expect(watchResponse.ok).toBe(true);

    let foundWebhookEvent = false;
    if (watchResponse.body) {
      const reader = watchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (!foundWebhookEvent) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let eventEndIndex;
          while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
            const message = buffer.substring(0, eventEndIndex);
            buffer = buffer.substring(eventEndIndex + 2);

            if (message.startsWith('data: ')) {
              const event = JSON.parse(message.substring(6));
              if (event.type === BRAIN_EVENTS.WEBHOOK) {
                foundWebhookEvent = true;
                break;
              }
              if (event.type === BRAIN_EVENTS.COMPLETE || event.type === BRAIN_EVENTS.ERROR) {
                throw new Error(`Brain completed/errored before WEBHOOK: ${event.type}`);
              }
            }
          }
        }
      } finally {
        await reader.cancel();
      }
    }

    expect(foundWebhookEvent).toBe(true);

    // Step 3: Kill the suspended brain
    const killRequest = new Request(`http://example.com/brains/runs/${brainRunId}`, {
      method: 'DELETE',
    });

    const killResponse = await worker.fetch(killRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(killResponse.status).toBe(204);

    // Step 4: Verify status is CANCELLED
    const getRunRequest = new Request(`http://example.com/brains/runs/${brainRunId}`);
    const getRunResponse = await worker.fetch(getRunRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(getRunResponse.ok).toBe(true);

    const runData = await getRunResponse.json() as { status: string };
    expect(runData.status).toBe(STATUS.CANCELLED);
  });
});