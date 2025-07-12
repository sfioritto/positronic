import { describe, it, expect } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';
import nock from 'nock';

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
        const { waitForOutput, instance } = await px(['run', 'test-brain', '--watch']);
        // The watch component should be rendered - first shows connecting message
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
        
        // Unmount the component to trigger EventSource cleanup
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should run a brain with short watch flag', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['run', 'test-brain', '-w']);
        // The watch component should be rendered - first shows connecting message
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
        
        // Unmount the component to trigger EventSource cleanup
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });


    it('should handle API server error responses', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the server to return a 500 error
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .post('/brains/runs')
          .reply(500, 'Internal Server Error');

        // Mock process.exit to prevent test from exiting
        const originalExit = process.exit;
        let exitCalled = false;
        process.exit = ((code?: number) => {
          exitCalled = true;
          throw new Error(`process.exit called with code ${code}`);
        }) as any;

        try {
          await expect(px(['run', 'test-brain'])).rejects.toThrow(
            'process.exit called with code 1'
          );
          expect(exitCalled).toBe(true);
        } finally {
          process.exit = originalExit;
        }
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle network connection errors (ECONNREFUSED)', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock a connection refused error
        const port = env.server.port;
        nock(`http://localhost:${port}`).post('/brains/runs').replyWithError({
          message: 'connect ECONNREFUSED',
          code: 'ECONNREFUSED',
        });

        // Mock process.exit to prevent test from exiting
        const originalExit = process.exit;
        let exitCalled = false;
        process.exit = ((code?: number) => {
          exitCalled = true;
          throw new Error(`process.exit called with code ${code}`);
        }) as any;

        try {
          await expect(px(['run', 'test-brain'])).rejects.toThrow(
            'process.exit called with code 1'
          );
          expect(exitCalled).toBe(true);
        } finally {
          process.exit = originalExit;
        }
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle other network errors', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock a different network error (without ECONNREFUSED code)
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .post('/brains/runs')
          .replyWithError({
            message: 'Network timeout error occurred',
            code: 'TIMEOUT',
          });

        // Mock process.exit to prevent test from exiting
        const originalExit = process.exit;
        let exitCalled = false;
        process.exit = ((code?: number) => {
          exitCalled = true;
          throw new Error(`process.exit called with code ${code}`);
        }) as any;

        try {
          await expect(px(['run', 'test-brain'])).rejects.toThrow(
            'process.exit called with code 1'
          );
          expect(exitCalled).toBe(true);
        } finally {
          process.exit = originalExit;
        }
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle network errors with specific error message', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock a network error with a specific message (not ECONNREFUSED)
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .post('/brains/runs')
          .replyWithError(new Error('DNS resolution failed'));

        // Mock process.exit to prevent test from exiting
        const originalExit = process.exit;
        let exitCalled = false;
        process.exit = ((code?: number) => {
          exitCalled = true;
          throw new Error(`process.exit called with code ${code}`);
        }) as any;

        try {
          await expect(px(['run', 'test-brain'])).rejects.toThrow(
            'process.exit called with code 1'
          );
          expect(exitCalled).toBe(true);
        } finally {
          process.exit = originalExit;
        }
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
        const { waitForOutput, instance } = await px([
          'watch',
          '--run-id',
          'test-run-123',
        ]);
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
        
        // Unmount the component to trigger EventSource cleanup
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should watch a brain run by run ID using short flag', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['watch', '--id', 'test-run-456']);
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
        
        // Unmount the component to trigger EventSource cleanup
        instance.unmount();
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


    it('should display all step statuses correctly', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'watch',
          '--run-id',
          'test-multi-status',
        ]);
        
        // Check for all different step statuses
        const foundComplete = await waitForOutput(/✔.*Complete Step/);
        expect(foundComplete).toBe(true);
        
        const foundError = await waitForOutput(/•.*Error Step/);
        expect(foundError).toBe(true);
        
        const foundRunning = await waitForOutput(/•.*Running Step/);
        expect(foundRunning).toBe(true);
        
        const foundPending = await waitForOutput(/•.*Pending Step/);
        expect(foundPending).toBe(true);
        
        // Unmount the component to trigger EventSource cleanup
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

  });

  describe('brain list command', () => {
    it('should list brains when no brains exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['list']);
        
        // Wait for the empty state message
        const foundEmpty = await waitForOutput(/No brains found/i, 30);
        expect(foundEmpty).toBe(true);
        
        // Verify API call was made
        const calls = env.server.getLogs();
        const listCall = calls.find(c => c.method === 'getBrains');
        expect(listCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should list brains when brains exist', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Add test brains before starting
      server.addBrain({
        name: 'daily-report',
        title: 'Daily Report Generator',
        description: 'Generates daily reports from various data sources',
        createdAt: Date.now() - 86400000,
        lastModified: Date.now() - 3600000,
      });
      
      server.addBrain({
        name: 'data-processor',
        title: 'Data Processing Pipeline',
        description: 'Processes incoming data and transforms it',
        createdAt: Date.now() - 172800000,
        lastModified: Date.now() - 7200000,
      });
      
      const px = await env.start();
      
      try {
        const { waitForOutput, instance } = await px(['list']);
        
        // Wait for brains to appear
        const foundBrains = await waitForOutput(/daily-report/i, 30);
        expect(foundBrains).toBe(true);
        
        // Check that all data is shown
        const output = instance.lastFrame() || '';
        expect(output).toContain('daily-report');
        expect(output).toContain('Daily Report Generator');
        expect(output).toContain('data-processor');
        expect(output).toContain('Data Processing Pipeline');
        
        // Verify API call
        const calls = server.getLogs();
        const listCall = calls.find(c => c.method === 'getBrains');
        expect(listCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle API errors gracefully', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error
      const { waitForOutput } = await px(['list'], { server: env.server });

      try {
        const foundError = await waitForOutput(/Error connecting to the local development server/i, 30);
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });
  });

  describe('brain history command', () => {
    it('should show not yet implemented message', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['history', 'test-brain']);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show not yet implemented message with custom limit', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'history',
          'test-brain',
          '--limit',
          '20',
        ]);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain show command', () => {
    it('should show not yet implemented message', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', 'test-brain']);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain rerun command', () => {
    it('should show not yet implemented message', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['rerun', 'test-brain']);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show not yet implemented message with run ID', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['rerun', 'test-brain', 'run-123']);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show not yet implemented message with step range', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'rerun',
          'test-brain',
          '--starts-at',
          '3',
          '--stops-after',
          '5',
        ]);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain new command', () => {
    it('should show not yet implemented message', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['brain', 'new', 'my-brain']);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show not yet implemented message with prompt', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'brain',
          'new',
          'my-brain',
          '--prompt',
          'Create a brain',
        ]);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show not yet implemented message using new alias', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['new', 'my-brain']);
        const isOutputRendered = await waitForOutput(
          /This command is not yet implemented/
        );
        expect(isOutputRendered).toBe(true);
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
