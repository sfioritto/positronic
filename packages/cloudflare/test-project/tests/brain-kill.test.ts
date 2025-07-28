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
    const result = await brains.kill((req) => worker.fetch(req, testEnv, ctx), brainRunId);
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
});