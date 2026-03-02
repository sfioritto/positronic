import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { resetMockState } from '../src/runner';
import { createAuthenticatedRequest } from './test-auth-helper';
import { readSseStream } from './sse-helpers';
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

describe('Signal API Tests', () => {
  beforeEach(() => {
    resetMockState();
  });

  async function createRunAndWaitForComplete(
    testEnv: TestEnv,
    brainTitle: string
  ): Promise<string> {
    const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainTitle }),
    });
    const createContext = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, testEnv, createContext);
    const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
    await waitOnExecutionContext(createContext);

    const watchRequest = await createAuthenticatedRequest(
      `http://example.com/brains/runs/${brainRunId}/watch`
    );
    const watchContext = createExecutionContext();
    const watchResponse = await worker.fetch(watchRequest, testEnv, watchContext);
    await readSseStream(watchResponse.body!);
    await waitOnExecutionContext(watchContext);

    return brainRunId;
  }

  describe('POST /brains/runs/:runId/signals', () => {
    it('should return 400 for invalid signal type', async () => {
      const testEnv = env as TestEnv;

      // Create a brain run first
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'basic-brain' }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
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
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(400);
      const body = await signalResponse.json<{ error: string }>();
      expect(body.error).toBe('Invalid signal type');
    });

    it('should return 409 when PAUSE signal sent to completed brain', async () => {
      const testEnv = env as TestEnv;

      // Create a brain run and wait for it to complete via SSE
      const brainRunId = await createRunAndWaitForComplete(testEnv, 'basic-brain');

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
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(409);
      const body = await signalResponse.json<{ error: string }>();
      expect(body.error).toContain("Cannot PAUSE brain in 'complete' state");
    });

    it('should return 409 when KILL signal sent to completed brain', async () => {
      const testEnv = env as TestEnv;

      // Create a brain run and wait for it to complete via SSE
      const brainRunId = await createRunAndWaitForComplete(testEnv, 'basic-brain');

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
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(409);
      const body = await signalResponse.json<{ error: string }>();
      expect(body.error).toContain("Cannot KILL brain in 'complete' state");
    });

    it('should return 404 for non-existent run', async () => {
      const testEnv = env as TestEnv;

      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/non-existent-id/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(404);
    });

    it('should return 202 and queue PAUSE signal', async () => {
      const testEnv = env as TestEnv;

      // Create a brain run
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'basic-brain' }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
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
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(202);
      const body = await signalResponse.json<{ success: boolean; signal: { type: string; queuedAt: number } }>();
      expect(body.success).toBe(true);
      expect(body.signal.type).toBe('PAUSE');
      expect(body.signal.queuedAt).toBeGreaterThan(0);
    });

    it('should return 202 and queue USER_MESSAGE signal', async () => {
      const testEnv = env as TestEnv;

      // Create a brain run
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'basic-brain' }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
      await waitOnExecutionContext(createContext);

      // Send USER_MESSAGE signal
      const signalRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'USER_MESSAGE', content: 'Hello from test!' }),
        }
      );
      const signalContext = createExecutionContext();
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(202);
      const body = await signalResponse.json<{ success: boolean; signal: { type: string; queuedAt: number } }>();
      expect(body.success).toBe(true);
      expect(body.signal.type).toBe('USER_MESSAGE');
    });
  });

  describe('POST /brains/runs/:runId/resume', () => {
    it('should return 404 for non-existent run', async () => {
      const testEnv = env as TestEnv;

      const resumeRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/non-existent-id/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const resumeContext = createExecutionContext();
      const resumeResponse = await worker.fetch(resumeRequest, testEnv, resumeContext);
      await waitOnExecutionContext(resumeContext);

      expect(resumeResponse.status).toBe(404);
    });

    it('should return 409 when brain is not paused', async () => {
      const testEnv = env as TestEnv;

      // Create a brain run and wait for it to complete via SSE
      const brainRunId = await createRunAndWaitForComplete(testEnv, 'basic-brain');

      // Try to resume
      const resumeRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const resumeContext = createExecutionContext();
      const resumeResponse = await worker.fetch(resumeRequest, testEnv, resumeContext);
      await waitOnExecutionContext(resumeContext);

      expect(resumeResponse.status).toBe(409);
      const body = await resumeResponse.json<{ error: string }>();
      expect(body.error).toContain('Cannot resume brain');
    });
  });

  describe('pause and resume integration', () => {
    it('should pause delayed brain and verify paused state', async () => {
      const testEnv = env as TestEnv;

      // Create a delayed brain run (takes 1.5s on first step)
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'delayed-brain' }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
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
      const signalResponse = await worker.fetch(signalRequest, testEnv, signalContext);
      await waitOnExecutionContext(signalContext);

      expect(signalResponse.status).toBe(202);

      // Wait for brain to pause (after first step completes)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify brain is paused
      const getRunRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}`,
        { method: 'GET' }
      );
      const getRunContext = createExecutionContext();
      const getRunResponse = await worker.fetch(getRunRequest, testEnv, getRunContext);
      await waitOnExecutionContext(getRunContext);
      const runDetails = await getRunResponse.json<{ status: string }>();
      expect(runDetails.status).toBe('paused');

      // Verify resume endpoint accepts the request (brain is in paused state)
      const resumeRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const resumeContext = createExecutionContext();
      const resumeResponse = await worker.fetch(resumeRequest, testEnv, resumeContext);
      await waitOnExecutionContext(resumeContext);

      expect(resumeResponse.status).toBe(202);
      const resumeBody = await resumeResponse.json<{ success: boolean; action: string }>();
      expect(resumeBody.success).toBe(true);
      expect(resumeBody.action).toBe('resumed');
    });

    it('should allow queueing messages while brain is paused', async () => {
      const testEnv = env as TestEnv;

      // Create a delayed brain run
      const createRequest = await createAuthenticatedRequest('http://example.com/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brainTitle: 'delayed-brain' }),
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(createRequest, testEnv, createContext);
      const { brainRunId } = await createResponse.json<{ brainRunId: string }>();
      await waitOnExecutionContext(createContext);

      // Send PAUSE signal
      const pauseRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        }
      );
      const pauseContext = createExecutionContext();
      await worker.fetch(pauseRequest, testEnv, pauseContext);
      await waitOnExecutionContext(pauseContext);

      // Wait for brain to pause
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send USER_MESSAGE while paused - should succeed (queued for when brain resumes)
      const msgRequest = await createAuthenticatedRequest(
        `http://example.com/brains/runs/${brainRunId}/signals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'USER_MESSAGE', content: 'Message while paused' }),
        }
      );
      const msgContext = createExecutionContext();
      const msgResponse = await worker.fetch(msgRequest, testEnv, msgContext);
      await waitOnExecutionContext(msgContext);

      expect(msgResponse.status).toBe(202);
      const msgBody = await msgResponse.json<{ success: boolean; signal: { type: string } }>();
      expect(msgBody.success).toBe(true);
      expect(msgBody.signal.type).toBe('USER_MESSAGE');
    });
  });
});
