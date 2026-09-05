import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import { resetMockState } from '../src/runner';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readSseStream } from './sse-helpers';
import type { BrainCompleteEvent } from '@positronic/core';

describe('Webhook Trigger Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('should start a new brain run when trigger webhook fires', async () => {
    const testEnv = env;

    // Send a webhook that triggers a new brain run
    const webhookRequest = await createAuthenticatedRequest(
      'http://example.com/webhooks/trigger-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'hello from webhook' }),
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch(webhookRequest, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(201);
    const body = await response.json<{
      received: boolean;
      action: string;
      brainRunId: string;
    }>();
    expect(body.received).toBe(true);
    expect(body.action).toBe('triggered');
    expect(body.brainRunId).toBeDefined();

    // Watch the triggered brain run to verify it actually executes
    const watchUrl = `http://example.com/brains/runs/${body.brainRunId}/watch`;
    const watchRequest = await createAuthenticatedRequest(watchUrl);
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );

    expect(watchResponse.status).toBe(200);
    const allEvents = await readSseStream(watchResponse.body!);

    const completeEvent = allEvents.find(
      (e): e is BrainCompleteEvent => e.type === BRAIN_EVENTS.COMPLETE
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.status).toBe(STATUS.COMPLETE);
  });

  it('should return ignored for ignore result type', async () => {
    const testEnv = env;

    const webhookRequest = await createAuthenticatedRequest(
      'http://example.com/webhooks/trigger-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ignore' }),
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch(webhookRequest, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(200);
    const body = await response.json<{ received: boolean; action: string }>();
    expect(body.received).toBe(true);
    expect(body.action).toBe('ignored');
  });

  it('should handle verification challenge for trigger webhooks', async () => {
    const testEnv = env;

    const webhookRequest = await createAuthenticatedRequest(
      'http://example.com/webhooks/trigger-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'url_verification',
          challenge: 'test-challenge-123',
        }),
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch(webhookRequest, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(200);
    const body = await response.json<{ challenge: string }>();
    expect(body.challenge).toBe('test-challenge-123');
  });

  it('should return 400 when webhook without triggers config returns trigger type', async () => {
    const testEnv = env;

    // trigger-no-config returns { type: 'trigger' } but has no triggers config
    const webhookRequest = await createAuthenticatedRequest(
      'http://example.com/webhooks/trigger-no-config',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      }
    );
    const context = createExecutionContext();
    const response = await worker.fetch(webhookRequest, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain('no triggers config');
  });
});
