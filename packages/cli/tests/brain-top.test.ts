import { describe, it, expect } from '@jest/globals';
import { createTestEnv } from './test-utils.js';
import { STATUS } from '@positronic/core';

describe('CLI Integration: positronic top command', () => {
  describe('top command', () => {
    it('should show empty state when no brains are running', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['top']);

        const foundEmpty = await waitForOutput(/No running brains/i, 30);
        expect(foundEmpty).toBe(true);

        const foundTip = await waitForOutput(/px run/i, 30);
        expect(foundTip).toBe(true);

        // Unmount to clean up EventSource
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should display running brains in table format', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Set up running brains for the watch endpoint
      server.setRunningBrainsForWatch([
        {
          brainRunId: 'run-123',
          brainTitle: 'test-brain',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 60000,
          startedAt: Date.now() - 60000,
        },
      ]);

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['top']);

        // Check for table headers
        const foundHeader = await waitForOutput(/Brain/i, 30);
        expect(foundHeader).toBe(true);

        // Check for brain data
        const foundBrain = await waitForOutput(/test-brain/i, 30);
        expect(foundBrain).toBe(true);

        const foundRunId = await waitForOutput(/run-123/i, 30);
        expect(foundRunId).toBe(true);

        // Verify API call was logged
        const calls = server.getLogs();
        const watchCall = calls.find((c) => c.method === 'watchAllBrains');
        expect(watchCall).toBeDefined();

        // Unmount to clean up EventSource
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should display multiple running brains', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.setRunningBrainsForWatch([
        {
          brainRunId: 'run-1',
          brainTitle: 'email-processor',
          type: 'scheduled',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 120000,
          startedAt: Date.now() - 120000,
        },
        {
          brainRunId: 'run-2',
          brainTitle: 'data-sync',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 60000,
          startedAt: Date.now() - 60000,
        },
        {
          brainRunId: 'run-3',
          brainTitle: 'weekly-report',
          type: 'scheduled',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 30000,
          startedAt: Date.now() - 30000,
        },
      ]);

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['top']);

        // Check for count
        const foundCount = await waitForOutput(/Running brains \(3\)/i, 30);
        expect(foundCount).toBe(true);

        // Check for all brains
        const foundEmail = await waitForOutput(/email-processor/i, 30);
        expect(foundEmail).toBe(true);

        const foundSync = await waitForOutput(/data-sync/i, 30);
        expect(foundSync).toBe(true);

        const foundReport = await waitForOutput(/weekly-report/i, 30);
        expect(foundReport).toBe(true);

        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should filter brains by name', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.setRunningBrainsForWatch([
        {
          brainRunId: 'run-1',
          brainTitle: 'email-processor',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 60000,
          startedAt: Date.now() - 60000,
        },
        {
          brainRunId: 'run-2',
          brainTitle: 'data-sync',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 30000,
          startedAt: Date.now() - 30000,
        },
      ]);

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['top', 'email']);

        // Should show email-processor
        const foundFiltered = await waitForOutput(/email-processor/i, 30);
        expect(foundFiltered).toBe(true);

        // Should show filtered count
        const foundCount = await waitForOutput(/Running brains \(1\)/i, 30);
        expect(foundCount).toBe(true);

        // Check that data-sync is NOT shown
        const output = instance.lastFrame() || '';
        expect(output).not.toContain('data-sync');

        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show empty state when filter matches no brains', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.setRunningBrainsForWatch([
        {
          brainRunId: 'run-1',
          brainTitle: 'email-processor',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now(),
          startedAt: Date.now(),
        },
      ]);

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['top', 'nonexistent']);

        const foundEmpty = await waitForOutput(
          /No running brains matching "nonexistent"/i,
          30
        );
        expect(foundEmpty).toBe(true);

        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should be accessible via brain subcommand', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['brain', 'top']);

        const foundEmpty = await waitForOutput(/No running brains/i, 30);
        expect(foundEmpty).toBe(true);

        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should be accessible via brain subcommand with filter', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.setRunningBrainsForWatch([
        {
          brainRunId: 'run-1',
          brainTitle: 'my-special-brain',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now(),
          startedAt: Date.now(),
        },
      ]);

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'brain',
          'top',
          'special',
        ]);

        const foundBrain = await waitForOutput(/my-special-brain/i, 30);
        expect(foundBrain).toBe(true);

        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show status with appropriate formatting', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.setRunningBrainsForWatch([
        {
          brainRunId: 'run-1',
          brainTitle: 'test-brain',
          type: 'manual',
          status: STATUS.RUNNING,
          createdAt: Date.now() - 60000,
          startedAt: Date.now() - 60000,
        },
      ]);

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['top']);

        // Should show RUNNING status
        const foundStatus = await waitForOutput(/running/i, 30);
        expect(foundStatus).toBe(true);

        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
