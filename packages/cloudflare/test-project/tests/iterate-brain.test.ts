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
import { readSseStream } from './sse-helpers';
import type {
  BrainEvent,
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

describe('Iterate Brain Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('should process all 7 items in a .brain() iterate step', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'iterate-brain-test';

    // Create the brain run
    const request = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: brainName }),
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    expect(response.status).toBe(201);
    const { brainRunId } = await response.json<{ brainRunId: string }>();
    await waitOnExecutionContext(context);

    // Watch the brain run via SSE
    const watchUrl = `http://example.com/brains/runs/${brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
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

    const allEvents = await readSseStream(watchResponse.body);
    await waitOnExecutionContext(watchContext);

    // Verify brain completed
    const completeEvent = allEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);

    // Find the STEP_COMPLETE for the iterate step
    const iterateStepComplete = allEvents.find(
      (e): e is StepCompletedEvent =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE && e.stepTitle === 'Process items'
    );
    expect(iterateStepComplete).toBeDefined();

    // The patch should add 'results' to the state
    const patch = iterateStepComplete?.patch;
    expect(patch).toBeDefined();
    const resultsOp = patch?.find(
      (op: any) => op.op === 'add' && op.path === '/results'
    );
    expect(resultsOp).toBeDefined();

    // Check all 7 items produced results
    const results = resultsOp?.value as any[];
    expect(results).toBeDefined();
    console.log(
      `[iterate-brain-test] results length: ${results?.length}, expected: 7`
    );
    console.log(
      `[iterate-brain-test] results:`,
      JSON.stringify(results, null, 2)
    );

    // THIS IS THE KEY ASSERTION — if the state machine bug is present,
    // fewer than 7 results will be returned
    expect(results.length).toBe(7);

    // Verify each result is a { item, result } pair with correct values
    for (let i = 0; i < 7; i++) {
      const { item, result: innerState } = results[i];
      expect(item).toBe(i + 1);
      expect(innerState.value).toBe(i + 1);
      expect(innerState.doubled).toBe((i + 1) * 2);
    }
  });
});
