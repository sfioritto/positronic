import { describe, it, expect } from '@jest/globals';
import { createTestEnv } from './test-utils.js';

describe('CLI Integration: positronic brain commands', () => {
  describe('brain run command', () => {
    it('should successfully run a brain and return run ID', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['run', 'test-brain']);
        const isOutputRendered = await waitForOutput(/Run ID: run-\d+/);
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should run a brain with watch option', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['run', 'test-brain', '--watch']);
        // The watch component should be rendered - first shows connecting message
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should run a brain with short watch flag', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['run', 'test-brain', '-w']);
        // The watch component should be rendered - first shows connecting message
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain watch command', () => {
    it('should watch a brain run by run ID', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'watch',
          '--run-id',
          'test-run-123',
        ]);
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should watch a brain run by run ID using short flag', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['watch', '--id', 'test-run-456']);
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show not implemented message when watching by brain name', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['watch', 'test-brain']);
        const isOutputRendered = await waitForOutput(
          /Watching by brain name is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error when no run ID or brain name provided', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // This will throw an error during yargs validation
        await expect(px(['watch'])).rejects.toThrow(
          'You must provide either a brain name or a --run-id'
        );
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('error handling', () => {
    it('should handle missing brain name for run command', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // This will throw an error during yargs validation
        await expect(px(['run'])).rejects.toThrow(
          'Not enough non-option arguments: got 0, need at least 1'
        );
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
