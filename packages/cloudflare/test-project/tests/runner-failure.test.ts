import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
  reset,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { MonitorDO } from '../src/index';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import type { BrainEvent } from '@positronic/core';
import { resetMockState } from '../src/runner';
import { createAuthenticatedRequest } from './test-auth-helper';

/**
 * A run can die for reasons its own code never sees: the Monitor DO rejects
 * an RPC, an R2 write fails, a reducer throws. Those happen in the runner's
 * dispatch loop, outside the event stream's try/catch, so no ERROR event is
 * emitted on its own. The runner is expected to write a terminal ERROR event
 * itself so the run ends as errored instead of sitting at "running" forever.
 *
 * The failure is injected by making the Monitor DO reject one event over
 * RPC, which is the shape of a real hiccup. Under @cloudflare/vitest-plugin
 * the main worker's Durable Objects run in the test isolate, so a prototype
 * spy reaches the live instance.
 */

const MONITOR_FAILURE_MESSAGE = 'Monitor DO unavailable';
const WAIT = { timeout: 2000, interval: 100 };

/**
 * Make the Monitor DO throw on the next event of the given type, then behave
 * normally again. Restoring after one throw matters: if the runner reacts to
 * the failure by emitting a terminal ERROR event, the Monitor has to be able
 * to record it.
 */
function failMonitorOnceOn(eventType: string) {
  const original = MonitorDO.prototype.handleBrainEvent;
  const spy = vi
    .spyOn(MonitorDO.prototype, 'handleBrainEvent')
    .mockImplementation(function (this: MonitorDO, event: BrainEvent<any>) {
      if (event.type === eventType) {
        spy.mockRestore();
        throw new Error(MONITOR_FAILURE_MESSAGE);
      }
      return original.call(this, event);
    });
}

async function startRun(brainTitle: string) {
  const request = await createAuthenticatedRequest(
    'http://example.com/brains/runs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle }),
    }
  );
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  expect(response.status).toBe(201);
  const { brainRunId } = await response.json<{ brainRunId: string }>();
  await waitOnExecutionContext(context);
  return brainRunId;
}

interface RunRecord {
  brainRunId: string;
  status: string;
  error: { name: string; message: string; stack?: string } | null;
  completedAt: number | null;
}

async function fetchRun(brainRunId: string) {
  const request = await createAuthenticatedRequest(
    `http://example.com/brains/runs/${brainRunId}`
  );
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  expect(response.status).toBe(200);
  await waitOnExecutionContext(context);
  return response.json<RunRecord>();
}

describe('Brain run whose infrastructure fails mid-run', () => {
  beforeEach(async () => {
    await reset();
    resetMockState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ends the run as errored instead of leaving it running', async () => {
    failMonitorOnceOn(BRAIN_EVENTS.STEP_COMPLETE);
    const brainRunId = await startRun('basic-brain');

    const run = await vi.waitFor(async () => {
      const run = await fetchRun(brainRunId);
      expect(run.status).toBe(STATUS.ERROR);
      return run;
    }, WAIT);

    expect(run.completedAt).not.toBeNull();
    expect(run.error?.message).toContain(MONITOR_FAILURE_MESSAGE);
  });
});
