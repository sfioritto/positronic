import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, applyPatches } from '@positronic/core';
import type {
  BrainEvent,
  StepCompletedEvent,
  StepStartedEvent,
} from '@positronic/core';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readSseStream } from './sse-helpers';

// rerun-test-brain is flat (no nested brains), so applying every
// STEP_COMPLETE patch in order reconstructs the final state.
function finalStateFromEvents(events: BrainEvent[]) {
  let state: any = {};
  for (const event of events) {
    if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
      const patch = (event as StepCompletedEvent).patch;
      if (patch) {
        state = applyPatches(state, patch);
      }
    }
  }
  return state;
}

async function watchToCompletion(testEnv: Cloudflare.Env, brainRunId: string) {
  const watchRequest = await createAuthenticatedRequest(
    `http://example.com/brains/runs/${brainRunId}/watch`
  );
  const watchContext = createExecutionContext();
  const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);
  expect(watchResponse.status).toBe(200);
  if (!watchResponse.body) {
    throw new Error('Watch response body is null');
  }
  return readSseStream(watchResponse.body);
}

describe('POST /brains/runs/rerun --starts-at', () => {
  it('re-executes only the steps from starts-at onward', async () => {
    const testEnv = env;

    // --- Run rerun-test-brain to completion ---
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'rerun-test-brain' }),
      }
    );
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    const firstRunEvents = await watchToCompletion(testEnv, brainRunId);
    const firstRunState = finalStateFromEvents(firstRunEvents);
    expect(firstRunState).toEqual({
      step1Runs: 1,
      step2Runs: 1,
      step3Runs: 1,
      step4Runs: 1,
    });

    // --- Rerun from step 3 ---
    const rerunRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: brainRunId, startsAt: 3 }),
      }
    );
    const rerunContext = createExecutionContext();
    const rerunResponse = await worker.fetch(
      rerunRequest,
      testEnv,
      rerunContext
    );
    expect(rerunResponse.status).toBe(200);
    await waitOnExecutionContext(rerunContext);

    // --- Watch the rerun to completion and inspect what actually ran ---
    const rerunEvents = await watchToCompletion(testEnv, brainRunId);

    // The truncated log keeps steps 1-2 from the original run and should
    // contain exactly one STEP_START per step overall.
    const stepStartTitles = rerunEvents
      .filter((e): e is StepStartedEvent => e.type === BRAIN_EVENTS.STEP_START)
      .map((e) => e.stepTitle);
    expect(stepStartTitles).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4']);

    // Steps 1-2 must NOT have re-executed; steps 3-4 must have run again.
    const rerunState = finalStateFromEvents(rerunEvents);
    expect(rerunState).toEqual({
      step1Runs: 1,
      step2Runs: 1,
      step3Runs: 2,
      step4Runs: 2,
    });
  });

  it('rejects starts-at beyond the number of completed steps instead of silently rerunning everything', async () => {
    const testEnv = env;

    // --- Run the 4-step brain to completion ---
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'rerun-test-brain' }),
      }
    );
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    const firstRunEvents = await watchToCompletion(testEnv, brainRunId);
    const firstRunState = finalStateFromEvents(firstRunEvents);

    // --- Rerun from step 12 of a 4-step brain ---
    const rerunRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: brainRunId, startsAt: 12 }),
      }
    );
    const rerunContext = createExecutionContext();
    const rerunResponse = await worker.fetch(
      rerunRequest,
      testEnv,
      rerunContext
    );
    await waitOnExecutionContext(rerunContext);

    // starts-at=12 is out of range for this run; the server should reject it
    // rather than fall back to rerunning the entire brain from step 1.
    expect(rerunResponse.status).toBe(400);
    const errorBody = await rerunResponse.json<{ error: string }>();
    expect(errorBody.error).toMatch(
      /Cannot rerun from step 12: run only has 4 completed steps/
    );

    // And no step may have re-executed.
    const statusRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`
    );
    const statusContext = createExecutionContext();
    const statusResponse = await worker.fetch(
      statusRequest,
      testEnv,
      statusContext
    );
    const statusData = await statusResponse.json<{ status: string }>();
    expect(statusData.status).toBe('complete');

    const eventsAfter = await watchToCompletion(testEnv, brainRunId);
    expect(finalStateFromEvents(eventsAfter)).toEqual(firstRunState);
  });

  // rerun() resumes execution via wakeUp(), which must hand the pages/files
  // services the original run UUID rather than the DO's own hex id — otherwise
  // pages created after a rerun would be attributed to an id no other
  // component (like MonitorDO) knows about.
  it('attributes pages created after rerun to the original run UUID', async () => {
    const testEnv = env;

    // --- Run auto-slug-brain to completion ---
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'auto-slug-brain' }),
      }
    );
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    expect(createResponse.status).toBe(201);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    await watchToCompletion(testEnv, brainRunId);

    // --- Rerun from step 1 ---
    const rerunRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: brainRunId, startsAt: 1 }),
      }
    );
    const rerunContext = createExecutionContext();
    const rerunResponse = await worker.fetch(
      rerunRequest,
      testEnv,
      rerunContext
    );
    expect(rerunResponse.status).toBe(200);
    await waitOnExecutionContext(rerunContext);

    // --- Watch the rerun to completion and inspect the resulting page slug ---
    const rerunEvents = await watchToCompletion(testEnv, brainRunId);
    const rerunState = finalStateFromEvents(rerunEvents);

    expect(rerunState.pageSlug).toMatch(
      new RegExp(`^page-${brainRunId.slice(0, 8)}-`)
    );
  });
});
