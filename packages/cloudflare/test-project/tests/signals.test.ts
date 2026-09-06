import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { STATUS } from '@positronic/core';
import { resetMockState } from '../src/runner';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readSseStream, waitForRunStatus } from './sse-helpers';

describe('Signal API Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  async function createRunAndWaitForComplete(
    testEnv: Cloudflare.Env,
    brainTitle: string
  ): Promise<string> {
    const createRequest = await createAuthenticatedRequest(
      'http://example.com/brains/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle }),
      }
    );
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(
      createRequest,
      testEnv,
      createContext
    );
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    const watchRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}/watch`
    );
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(
      watchRequest,
      testEnv,
      watchContext
    );
    await readSseStream(watchResponse.body!);
    await waitOnExecutionContext(watchContext);

    return brainRunId;
  }

  describe('POST /brains/runs/:runId/signals', () => {
    it('should return 400 for invalid signal type', async () => {
      const testEnv = env;

      // Create a brain run first
      const createRequest = await createAuthenticatedRequest(
        'http://example.com/brains/runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brainTitle: 'basic-brain' }),
        }
      );
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Send invalid signal type
      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'INVALID_TYPE' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(
        signalRequest,
        testEnv,
        signalContext
      );
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(400);
      const body = await signalResponse.json<{ error: string }>();
      expect(body.error).toBe('Invalid signal type');
    });

    it('should return 409 when PAUSE signal sent to completed brain', async () => {
      const testEnv = env;

      // Create a brain run and wait for it to complete via SSE
      const brainRunId = await createRunAndWaitForComplete(
        testEnv,
        'basic-brain'
      );

      // Now send PAUSE signal - should be rejected
      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(
        signalRequest,
        testEnv,
        signalContext
      );
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(409);
      const body = await signalResponse.json<{ error: string }>();
      expect(body.error).toContain("Cannot PAUSE brain in 'complete' state");
    });

    it('should return 409 when KILL signal sent to completed brain', async () => {
      const testEnv = env;

      // Create a brain run and wait for it to complete via SSE
      const brainRunId = await createRunAndWaitForComplete(
        testEnv,
        'basic-brain'
      );

      // Now send KILL signal - should be rejected
      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'KILL' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(
        signalRequest,
        testEnv,
        signalContext
      );
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(409);
      const body = await signalResponse.json<{ error: string }>();
      expect(body.error).toContain("Cannot KILL brain in 'complete' state");
    });

    it('should return 404 for non-existent run', async () => {
      const testEnv = env;

      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/non-existent-id/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(
        signalRequest,
        testEnv,
        signalContext
      );
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(404);
    });

    it('should return 202 and queue PAUSE signal', async () => {
      const testEnv = env;

      // Create a brain run
      const createRequest = await createAuthenticatedRequest(
        'http://example.com/brains/runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brainTitle: 'basic-brain' }),
        }
      );
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Send PAUSE signal
      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(
        signalRequest,
        testEnv,
        signalContext
      );
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(202);
      const body = await signalResponse.json<{
        success: boolean;
        signal: { type: string; queuedAt: number };
      }>();
      expect(body.success).toBe(true);
      expect(body.signal.type).toBe('PAUSE');
      expect(body.signal.queuedAt).toBeGreaterThan(0);
    });
  });

  describe('POST /brains/runs/:runId/resume', () => {
    it('should return 404 for non-existent run', async () => {
      const testEnv = env;

      const resumeRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/non-existent-id/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const resumeContext = createExecutionContext();
      const resumeResponse = await worker.fetch(
        resumeRequest,
        testEnv,
        resumeContext
      );
      await waitOnExecutionContext(resumeContext);

      expect(resumeResponse.status).toBe(404);
    });

    it('should return 409 when brain is not paused', async () => {
      const testEnv = env;

      // Create a brain run and wait for it to complete via SSE
      const brainRunId = await createRunAndWaitForComplete(
        testEnv,
        'basic-brain'
      );

      // Try to resume
      const resumeRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const resumeContext = createExecutionContext();
      const resumeResponse = await worker.fetch(
        resumeRequest,
        testEnv,
        resumeContext
      );
      await waitOnExecutionContext(resumeContext);

      expect(resumeResponse.status).toBe(409);
      const body = await resumeResponse.json<{ error: string }>();
      expect(body.error).toContain('Cannot resume brain');
    });
  });

  describe('pause and resume integration', () => {
    it('should pause delayed brain and verify paused state', async () => {
      const testEnv = env;

      // Create a delayed brain run (takes 1.5s on first step)
      const createRequest = await createAuthenticatedRequest(
        'http://example.com/brains/runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brainTitle: 'delayed-brain' }),
        }
      );
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      const { brainRunId } = await createResponse.json<{
        brainRunId: string;
      }>();
      await waitOnExecutionContext(createContext);

      // Send PAUSE signal immediately
      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(
        signalRequest,
        testEnv,
        signalContext
      );
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(202);

      // Signals are consumed between steps, so the brain pauses once its
      // 1.5s first step completes. Poll the run until the Monitor sees it.
      await waitForRunStatus(testEnv, brainRunId, STATUS.PAUSED);

      // Verify resume endpoint accepts the request (brain is in paused state)
      const resumeRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const resumeContext = createExecutionContext();
      const resumeResponse = await worker.fetch(
        resumeRequest,
        testEnv,
        resumeContext
      );
      await waitOnExecutionContext(resumeContext);

      expect(resumeResponse.status).toBe(202);
      const resumeBody = await resumeResponse.json<{
        success: boolean;
        action: string;
      }>();
      expect(resumeBody.success).toBe(true);
      expect(resumeBody.action).toBe('resumed');
    });
  });
});
