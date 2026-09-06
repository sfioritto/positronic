import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { brains } from '@positronic/spec';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import {
  createAuthenticatedRequest,
  createAuthenticatedFetchWrapper,
} from './test-auth-helper';
import { waitForRunStatus } from './sse-helpers';

describe('Brain Kill API', () => {
  // Helper to create authenticated fetch for spec tests
  const createAuthFetch = (testEnv: Cloudflare.Env, ctx: ExecutionContext) => {
    const baseFetch = async (req: Request) => worker.fetch(req, testEnv, ctx);
    return createAuthenticatedFetchWrapper(baseFetch);
  };

  it('should pass the spec test for killing a brain run', async () => {
    const testEnv = env;
    const ctx = createExecutionContext();

    // First create a brain run
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'delayed-brain' }),
      }
    );

    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);

    const { brainRunId } = (await createResponse.json()) as {
      brainRunId: string;
    };

    // The START event reaches the Monitor by RPC after the create request has
    // returned, and kill looks the run up in the Monitor.
    await waitForRunStatus(testEnv, brainRunId, STATUS.RUNNING);

    // Test via spec
    const result = await brains.kill(createAuthFetch(testEnv, ctx), brainRunId);
    expect(result).toBe(true);

    // Killing an active brain aborts its run, but the step that is executing
    // (the delayed brain's 1.5s sleep) finishes before the runner emits
    // CANCELLED. Wait for that so the run does not outlive the test.
    await waitForRunStatus(testEnv, brainRunId, STATUS.CANCELLED);
  });

  it('should return 404 for non-existent brain run', async () => {
    const testEnv = env;
    const ctx = createExecutionContext();
    const runId = 'non-existent-run';

    const request = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${runId}`,
      {
        method: 'DELETE',
      }
    );

    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });

  it('should kill an active brain run', async () => {
    const testEnv = env;
    const ctx = createExecutionContext();

    // First create a brain run
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'delayed-brain' }),
      }
    );

    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);

    const { brainRunId } = (await createResponse.json()) as {
      brainRunId: string;
    };

    // The START event reaches the Monitor by RPC after the create request has
    // returned, and kill looks the run up in the Monitor.
    await waitForRunStatus(testEnv, brainRunId, STATUS.RUNNING);

    // Kill the brain run
    const killRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`,
      {
        method: 'DELETE',
      }
    );

    const killResponse = await worker.fetch(killRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(killResponse.status).toBe(204);

    // The runner emits CANCELLED once the delayed brain's 1.5s step finishes.
    await waitForRunStatus(testEnv, brainRunId, STATUS.CANCELLED);

    // The killed run shows as cancelled in the brain's history
    const historyRequest = await createAuthenticatedRequest(
      `http://example.com/brains/delayed-brain/history?limit=1`
    );
    const historyResponse = await worker.fetch(historyRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(historyResponse.status).toBe(200);

    const { runs } = (await historyResponse.json()) as {
      runs: Array<{ brainRunId: string; status: string }>;
    };
    const killedRun = runs.find((r) => r.brainRunId === brainRunId);
    expect(killedRun?.status).toBe(STATUS.CANCELLED);
  });

  it('should kill a brain suspended on a webhook via spec test', async () => {
    const testEnv = env;
    const ctx = createExecutionContext();

    const result = await brains.killSuspended(
      createAuthFetch(testEnv, ctx),
      'agent-webhook-brain',
      'loop-escalation',
      {
        escalationId: 'test-escalation-123',
        approved: true,
        note: 'Approved after kill',
      }
    );

    expect(result).toBe(true);
  });

  it('should kill a brain suspended on a webhook and update status to CANCELLED', async () => {
    const testEnv = env;
    const ctx = createExecutionContext();

    // Step 1: Start the agent-webhook-brain
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'agent-webhook-brain' }),
      }
    );

    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);

    const { brainRunId } = (await createResponse.json()) as {
      brainRunId: string;
    };

    // Step 2: Watch until WEBHOOK event (brain suspends)
    const watchRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}/watch`
    );
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
              if (
                event.type === BRAIN_EVENTS.COMPLETE ||
                event.type === BRAIN_EVENTS.ERROR
              ) {
                throw new Error(
                  `Brain completed/errored before WEBHOOK: ${event.type}`
                );
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
    const killRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`,
      {
        method: 'DELETE',
      }
    );

    const killResponse = await worker.fetch(killRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(killResponse.status).toBe(204);

    // Step 4: Verify status is CANCELLED
    const getRunRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`
    );
    const getRunResponse = await worker.fetch(getRunRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(getRunResponse.ok).toBe(true);

    const runData = (await getRunResponse.json()) as { status: string };
    expect(runData.status).toBe(STATUS.CANCELLED);
  });

  it('should clean up non-persistent pages when killing a suspended brain', async () => {
    const testEnv = env;
    const ctx = createExecutionContext();

    // Step 1: Start the page-webhook-brain (creates a page and waits for webhook)
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'page-webhook-brain' }),
      }
    );

    const createResponse = await worker.fetch(createRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(createResponse.status).toBe(201);

    const { brainRunId } = (await createResponse.json()) as {
      brainRunId: string;
    };

    // Step 2: Watch until WEBHOOK event (brain suspends after creating page)
    const watchRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}/watch`
    );
    const watchResponse = await worker.fetch(watchRequest, testEnv, ctx);
    expect(watchResponse.ok).toBe(true);

    let foundWebhookEvent = false;
    let pageSlug: string | null = null;

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

              // Capture the page slug from STEP_COMPLETE event
              if (event.type === BRAIN_EVENTS.STEP_COMPLETE && event.patch) {
                // The patch might contain the pageSlug
                for (const op of event.patch) {
                  if (op.path === '/pageSlug' && op.op === 'add') {
                    pageSlug = op.value;
                  }
                }
              }

              if (event.type === BRAIN_EVENTS.WEBHOOK) {
                foundWebhookEvent = true;
                break;
              }
              if (
                event.type === BRAIN_EVENTS.COMPLETE ||
                event.type === BRAIN_EVENTS.ERROR
              ) {
                throw new Error(
                  `Brain completed/errored before WEBHOOK: ${event.type}`
                );
              }
            }
          }
        }
      } finally {
        await reader.cancel();
      }
    }

    expect(foundWebhookEvent).toBe(true);
    expect(pageSlug).not.toBeNull();

    // Step 3: Verify the page exists in R2 before killing
    const pageExistsRequest = await createAuthenticatedRequest(
      `http://example.com/pages/${pageSlug}`
    );
    const pageExistsResponse = await worker.fetch(
      pageExistsRequest,
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(pageExistsResponse.status).toBe(200);

    // Step 4: Kill the suspended brain
    const killRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}`,
      {
        method: 'DELETE',
      }
    );

    const killResponse = await worker.fetch(killRequest, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(killResponse.status).toBe(204);

    // Step 5: Verify the page has been cleaned up from R2
    const pageDeletedRequest = await createAuthenticatedRequest(
      `http://example.com/pages/${pageSlug}`
    );
    const pageDeletedResponse = await worker.fetch(
      pageDeletedRequest,
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(pageDeletedResponse.status).toBe(404);
  });
});
