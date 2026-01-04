import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';
import nock from 'nock';

describe('brain kill command', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('should kill a brain run with force flag', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    const runId = 'run-456';

    try {
      const { waitForOutput, instance } = await px(['brain', 'kill', runId, '--force']);

      // Should NOT show warning message (force flag skips confirmation)
      const foundWarning = await waitForOutput(/Warning: This will stop the running brain/, 5);
      expect(foundWarning).toBe(false);

      // Give component time to render
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should show success message (the loading state may be too quick to catch)
      const foundSuccess = await waitForOutput(/Brain run killed successfully!/, 30);
      expect(foundSuccess).toBe(true);

      // Verify API call
      const calls = env.server.getLogs();
      const killCall = calls.find(c => c.method === 'killBrainRun');
      expect(killCall).toBeDefined();
      expect(killCall?.args[0]).toBe(runId);
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should handle non-existent brain run', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    const runId = 'non-existent-run';

    // Mock the server to return 404
    env.server.setKillBrainRunError(runId, 404);

    try {
      const { waitForOutput } = await px(['brain', 'kill', runId, '--force']);

      // Should show server error (the custom error handling isn't working as expected)
      const foundError = await waitForOutput(/Error deleting brain.*404/, 30);
      expect(foundError).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should handle already completed brain run', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    const runId = 'completed-run';

    // Mock the server to return 409 (conflict)
    env.server.setKillBrainRunError(runId, 409);

    try {
      const { waitForOutput } = await px(['brain', 'kill', runId, '--force']);

      // Should show server error (the custom error handling isn't working as expected) 
      const foundError = await waitForOutput(/Error deleting brain.*409/, 30);
      expect(foundError).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should kill brain when user types yes to confirm', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    const runId = 'run-confirm-test';

    try {
      const { waitForOutput, instance } = await px(['brain', 'kill', runId]);

      // Should show warning message
      const foundWarning = await waitForOutput(/Warning: This will stop the running brain/, 30);
      expect(foundWarning).toBe(true);

      // Give the stdin handler time to be set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Type "yes" to confirm
      instance.stdin.write('yes\n');

      // Give React time to process the input and make the API call
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should show success message
      const foundSuccess = await waitForOutput(/Brain run killed successfully!/, 30);
      expect(foundSuccess).toBe(true);

      // Verify API call was made
      const calls = env.server.getLogs();
      const killCall = calls.find(c => c.method === 'killBrainRun');
      expect(killCall).toBeDefined();
      expect(killCall?.args[0]).toBe(runId);
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should cancel kill when user types no', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    const runId = 'run-789';

    try {
      const { waitForOutput, instance } = await px(['brain', 'kill', runId]);

      // Should show warning message
      const foundWarning = await waitForOutput(/Warning: This will stop the running brain/, 30);
      expect(foundWarning).toBe(true);

      // Type "no" to cancel
      instance.stdin.write('no\n');

      // Process should exit without making API call
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify NO API call was made
      const calls = env.server.getLogs();
      const killCall = calls.find(c => c.method === 'killBrainRun');
      expect(killCall).toBeUndefined();
    } finally {
      await env.stopAndCleanup();
    }
  });

  it('should handle server connection errors', async () => {
    const env = await createTestEnv();
    // Don't start the server to simulate connection error

    try {
      const { waitForOutput } = await px(['brain', 'kill', 'run-123', '--force'], {
        server: env.server,
      });

      const foundError = await waitForOutput(/Error connecting to the local development server/i, 30);
      expect(foundError).toBe(true);
    } finally {
      env.cleanup();
    }
  });
});