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


    it('should handle brain not found (404) error with helpful message', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['run', 'non-existent-brain']);

        // Check for error component output
        const foundErrorTitle = await waitForOutput(/Brain Not Found/i, 30);
        expect(foundErrorTitle).toBe(true);

        const foundErrorMessage = await waitForOutput(/Brain 'non-existent-brain' not found/i, 30);
        expect(foundErrorMessage).toBe(true);

        const foundHelpText = await waitForOutput(/brain name is spelled correctly/i, 30);
        expect(foundHelpText).toBe(true);

        // Verify the API was called
        const calls = env.server.getLogs();
        const runCall = calls.find(c => c.method === 'createBrainRun');
        expect(runCall).toBeDefined();
        expect(runCall?.args[0]).toBe('non-existent-brain');
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

    it('should watch the single active run when watching by brain name', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Add a running brain run
      server.addBrainRun({
        brainRunId: 'run-active-123',
        brainTitle: 'test brain',
        type: 'START',
        status: 'RUNNING',
        createdAt: Date.now() - 60000, // 1 minute ago
        startedAt: Date.now() - 60000,
      });
      
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['watch', 'test-brain']);
        
        // Should connect to watch the active run
        const isOutputRendered = await waitForOutput(
          /Connecting to watch service|Brain: test-brain/
        );
        expect(isOutputRendered).toBe(true);
        
        // Verify API was called to get active runs
        const calls = server.getLogs();
        const activeRunsCall = calls.find(c => c.method === 'getBrainActiveRuns');
        expect(activeRunsCall).toBeDefined();
        expect(activeRunsCall?.args[0]).toBe('test-brain');
        
        // Unmount the component to trigger EventSource cleanup
        instance.unmount();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error when no active runs found for brain name', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['watch', 'test-brain']);
        
        // Should show no active runs error
        const foundTitle = await waitForOutput(/No Active Runs/i, 30);
        expect(foundTitle).toBe(true);
        
        const foundMessage = await waitForOutput(/No currently running brain runs found for brain "test-brain"/i, 30);
        expect(foundMessage).toBe(true);
        
        const foundDetails = await waitForOutput(/positronic run test-brain/i, 30);
        expect(foundDetails).toBe(true);
        
        // Verify API was called
        const calls = env.server.getLogs();
        const activeRunsCall = calls.find(c => c.method === 'getBrainActiveRuns');
        expect(activeRunsCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error when multiple active runs found for brain name', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Add multiple running brain runs
      server.addBrainRun({
        brainRunId: 'run-active-1',
        brainTitle: 'test brain',
        type: 'START',
        status: 'RUNNING',
        createdAt: Date.now() - 120000, // 2 minutes ago
        startedAt: Date.now() - 120000,
      });
      
      server.addBrainRun({
        brainRunId: 'run-active-2',
        brainTitle: 'test brain',
        type: 'START',
        status: 'RUNNING',
        createdAt: Date.now() - 60000, // 1 minute ago
        startedAt: Date.now() - 60000,
      });
      
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['watch', 'test-brain']);
        
        // Should show multiple active runs error
        const foundTitle = await waitForOutput(/Multiple Active Runs/i, 30);
        expect(foundTitle).toBe(true);
        
        const foundMessage = await waitForOutput(/Found 2 active runs for brain "test-brain"/i, 30);
        expect(foundMessage).toBe(true);
        
        const foundDetails = await waitForOutput(/positronic watch --run-id run-active-/i, 30);
        expect(foundDetails).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle API errors when looking up active runs', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the server to return a 500 error for active-runs endpoint
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get(/^\/brains\/(.+)\/active-runs$/)
          .reply(500, 'Internal Server Error');

        const { waitForOutput } = await px(['watch', 'test-brain']);
        
        // Should show API error
        const foundTitle = await waitForOutput(/API Error/i, 30);
        expect(foundTitle).toBe(true);
        
        const foundMessage = await waitForOutput(/Failed to get active runs for brain "test-brain"/i, 30);
        expect(foundMessage).toBe(true);
        
        const foundDetails = await waitForOutput(/Server returned 500/i, 30);
        expect(foundDetails).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle connection errors when looking up active runs', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error

      try {
        const { waitForOutput } = await px(['watch', 'test-brain'], { server: env.server });
        
        // Should show connection error
        const foundTitle = await waitForOutput(/Connection Error/i, 30);
        expect(foundTitle).toBe(true);
        
        const foundMessage = await waitForOutput(/Error connecting to the local development server/i, 30);
        expect(foundMessage).toBe(true);
        
        const foundDetails = await waitForOutput(/positronic server/i, 30);
        expect(foundDetails).toBe(true);
      } finally {
        env.cleanup();
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
    it('should show empty history when no runs exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['history', 'test-brain']);
        const foundMessage = await waitForOutput(/No run history found for brain: test-brain/i, 30);
        expect(foundMessage).toBe(true);
        
        // Verify API call was made
        const calls = env.server.getLogs();
        const historyCall = calls.find(c => c.method === 'getBrainHistory');
        expect(historyCall).toBeDefined();
        expect(historyCall?.args[0]).toBe('test-brain');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show brain run history when runs exist', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Add some brain runs to history
      server.addBrainRun({
        brainRunId: 'run-123',
        brainTitle: 'Test Brain',
        brainDescription: 'A test brain',
        type: 'START',
        status: 'COMPLETE',
        createdAt: Date.now() - 3600000, // 1 hour ago
        startedAt: Date.now() - 3600000,
        completedAt: Date.now() - 3540000, // 1 minute duration
      });
      
      server.addBrainRun({
        brainRunId: 'run-456',
        brainTitle: 'Test Brain',
        type: 'START',
        status: 'ERROR',
        error: { message: 'Connection failed' },
        createdAt: Date.now() - 7200000, // 2 hours ago
        startedAt: Date.now() - 7200000,
      });
      
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['history', 'test-brain']);
        
        // Check for header
        const foundHeader = await waitForOutput(/Recent runs for brain "test-brain"/i, 30);
        expect(foundHeader).toBe(true);
        
        // Check for run IDs
        const foundRun1 = await waitForOutput(/run-123/i, 30);
        expect(foundRun1).toBe(true);
        
        const foundRun2 = await waitForOutput(/run-456/i, 30);
        expect(foundRun2).toBe(true);
        
        // Check for statuses
        const foundComplete = await waitForOutput(/COMPLETE/i, 30);
        expect(foundComplete).toBe(true);
        
        const foundError = await waitForOutput(/ERROR/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should respect custom limit parameter', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'history',
          'test-brain',
          '--limit',
          '20',
        ]);
        
        // Wait for the component to render
        await waitForOutput(/run history|Recent runs/i, 30);
        
        // Verify API was called with correct limit
        const calls = env.server.getLogs();
        const historyCall = calls.find(c => c.method === 'getBrainHistory');
        expect(historyCall).toBeDefined();
        expect(historyCall?.args[1]).toBe(20);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error details for failed runs', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Add a failed brain run
      server.addBrainRun({
        brainRunId: 'run-error',
        brainTitle: 'Test Brain',
        type: 'START',
        status: 'ERROR',
        error: 'Connection timeout',
        createdAt: Date.now() - 1800000,
        startedAt: Date.now() - 1800000,
      });
      
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['history', 'test-brain']);
        
        // Check for error section
        const foundErrors = await waitForOutput(/Errors:/i, 30);
        expect(foundErrors).toBe(true);
        
        // Check for error message
        const foundErrorMsg = await waitForOutput(/Connection timeout/i, 30);
        expect(foundErrorMsg).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error
      
      try {
        const { waitForOutput } = await px(['history', 'test-brain'], { server: env.server });
        
        const foundError = await waitForOutput(/Error connecting to the local development server/i, 30);
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    it('should handle API server errors', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the server to return a 500 error
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get(/^\/brains\/(.+)\/history/)
          .reply(500, 'Internal Server Error');

        const { waitForOutput } = await px(['history', 'test-brain']);
        
        // The ErrorComponent will display the error
        const foundError = await waitForOutput(/Error:|Failed|500/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain show command', () => {
    it('should show brain structure when brain exists', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Add a brain to the test server with structure
      server.addBrain({
        name: 'test-brain',
        title: 'Test Brain',
        description: 'A test brain for unit testing',
        steps: [
          {
            type: 'step',
            title: 'Initialize',
          },
          {
            type: 'step',
            title: 'Process Data',
          },
          {
            type: 'brain',
            title: 'Nested Analysis',
            innerBrain: {
              title: 'Inner Brain',
              description: 'Performs nested analysis',
              steps: [
                {
                  type: 'step',
                  title: 'Analyze Subset',
                },
              ],
            },
          },
        ],
      });
      
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', 'test-brain']);
        
        // Check for brain title
        const foundTitle = await waitForOutput(/Test Brain/, 30);
        expect(foundTitle).toBe(true);
        
        // Check for description
        const foundDescription = await waitForOutput(/A test brain for unit testing/, 30);
        expect(foundDescription).toBe(true);
        
        // Check for steps
        const foundSteps = await waitForOutput(/• Initialize/, 30);
        expect(foundSteps).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error when brain does not exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', 'non-existent-brain']);
        const foundError = await waitForOutput(/Brain 'non-existent-brain' not found/, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain rerun command', () => {
    it('should successfully rerun a brain without specific run ID', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['rerun', 'test-brain']);
        
        // Check for success message
        const foundSuccess = await waitForOutput(/Brain rerun started successfully/i, 30);
        expect(foundSuccess).toBe(true);
        
        // Check for new run ID
        const foundRunId = await waitForOutput(/New run ID:.*rerun-/i, 30);
        expect(foundRunId).toBe(true);
        
        // Check for descriptive text
        const foundDescription = await waitForOutput(/Rerunning brain "test-brain"/i, 30);
        expect(foundDescription).toBe(true);
        
        // Check for watch command suggestion
        const foundWatchSuggestion = await waitForOutput(/Watch the run with: positronic watch --run-id/i, 30);
        expect(foundWatchSuggestion).toBe(true);
        
        // Verify API call
        const calls = env.server.getLogs();
        const rerunCall = calls.find(c => c.method === 'rerunBrain');
        expect(rerunCall).toBeDefined();
        expect(rerunCall?.args[0]).toBe('test-brain');
        expect(rerunCall?.args[1]).toBeUndefined(); // no runId
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should successfully rerun a brain with specific run ID', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['rerun', 'test-brain', 'run-123']);
        
        // Check for success message
        const foundSuccess = await waitForOutput(/Brain rerun started successfully/i, 30);
        expect(foundSuccess).toBe(true);
        
        // Check for run details
        const foundRunDetails = await waitForOutput(/from run run-123/i, 30);
        expect(foundRunDetails).toBe(true);
        
        // Verify API call
        const calls = env.server.getLogs();
        const rerunCall = calls.find(c => c.method === 'rerunBrain');
        expect(rerunCall).toBeDefined();
        expect(rerunCall?.args[0]).toBe('test-brain');
        expect(rerunCall?.args[1]).toBe('run-123');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should successfully rerun a brain with step range options', async () => {
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
        
        // Check for success message
        const foundSuccess = await waitForOutput(/Brain rerun started successfully/i, 30);
        expect(foundSuccess).toBe(true);
        
        // Check for step range details
        const foundStepRange = await waitForOutput(/starting at step 3, stopping after step 5/i, 30);
        expect(foundStepRange).toBe(true);
        
        // Verify API call
        const calls = env.server.getLogs();
        const rerunCall = calls.find(c => c.method === 'rerunBrain');
        expect(rerunCall).toBeDefined();
        expect(rerunCall?.args[0]).toBe('test-brain');
        expect(rerunCall?.args[1]).toBeUndefined(); // no runId
        expect(rerunCall?.args[2]).toBe(3); // startsAt
        expect(rerunCall?.args[3]).toBe(5); // stopsAfter
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle brain not found error', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['rerun', 'non-existent-brain']);
        
        // Check for error title
        const foundErrorTitle = await waitForOutput(/Brain Rerun Failed/i, 30);
        expect(foundErrorTitle).toBe(true);
        
        // Check for error message
        const foundErrorMessage = await waitForOutput(/Brain 'non-existent-brain' not found/i, 30);
        expect(foundErrorMessage).toBe(true);
        
        // Check for helpful details
        const foundDetails = await waitForOutput(/positronic brain list/i, 30);
        expect(foundDetails).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle run ID not found error', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['rerun', 'test-brain', 'non-existent-run']);
        
        // Check for error title
        const foundErrorTitle = await waitForOutput(/Brain Rerun Failed/i, 30);
        expect(foundErrorTitle).toBe(true);
        
        // Check for error message
        const foundErrorMessage = await waitForOutput(/Brain run 'non-existent-run' not found/i, 30);
        expect(foundErrorMessage).toBe(true);
        
        // Check for helpful details with runId
        const foundDetails = await waitForOutput(/positronic brain history test-brain/i, 30);
        expect(foundDetails).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error

      try {
        const { waitForOutput } = await px(['rerun', 'test-brain'], { server: env.server });
        
        // Check for error title
        const foundErrorTitle = await waitForOutput(/Brain Rerun Failed/i, 30);
        expect(foundErrorTitle).toBe(true);
        
        // Check for connection error
        const foundConnectionError = await waitForOutput(/Connection error/i, 30);
        expect(foundConnectionError).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    it('should handle API server errors', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the server to return a 500 error
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .post('/brains/runs/rerun')
          .reply(500, 'Internal Server Error');

        const { waitForOutput } = await px(['rerun', 'test-brain']);
        
        // Check for error title
        const foundErrorTitle = await waitForOutput(/Brain Rerun Failed/i, 30);
        expect(foundErrorTitle).toBe(true);
        
        // Check for server error
        const foundServerError = await waitForOutput(/Server returned 500/i, 30);
        expect(foundServerError).toBe(true);
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
