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
import type { BrainCompleteEvent, StepCompletedEvent } from '@positronic/core';
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

describe('Iterate with Options Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('should preserve options across DO resume during iterate', async () => {
    const testEnv = env as TestEnv;
    const brainName = 'iterate-options-test';

    // Create the brain run with options
    const request = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brainTitle: brainName,
          options: { multiplier: 10 },
        }),
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

    // Verify brain completed (not errored)
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

    // Check all 3 items produced results
    const results = resultsOp?.value as any[];
    expect(results).toBeDefined();
    expect(results.length).toBe(3);

    // Each result should be { item, result: { value, result } } where result = item * multiplier(10)
    for (let i = 0; i < 3; i++) {
      const { item, result: innerState } = results[i];
      expect(item).toBe(i + 1);
      expect(innerState.value).toBe(i + 1);
      expect(innerState.result).toBe((i + 1) * 10);
    }

    // Verify the final step had access to options too (survived resume)
    const verifyStepComplete = allEvents.find(
      (e): e is StepCompletedEvent =>
        e.type === BRAIN_EVENTS.STEP_COMPLETE &&
        e.stepTitle === 'Verify options'
    );
    expect(verifyStepComplete).toBeDefined();

    // The patch should set finalMultiplier to 10
    const verifyPatch = verifyStepComplete?.patch;
    expect(verifyPatch).toBeDefined();
    const multiplierOp = verifyPatch?.find(
      (op: any) => op.path === '/finalMultiplier'
    );
    expect(multiplierOp).toBeDefined();
    expect(multiplierOp?.value).toBe(10);
  });
});
