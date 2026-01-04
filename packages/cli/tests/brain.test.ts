import { describe, it, expect } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';
import nock from 'nock';
import { STATUS } from '@positronic/core';

describe('CLI Integration: positronic brain commands', () => {
  describe('brain run command', () => {
    it('should successfully run a brain and return run ID', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add test brain to mock server
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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
      const { server } = env;

      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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
      const { server } = env;

      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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

    it('should run a brain with options', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'run',
          'test-brain',
          '-o',
          'channel=#general',
          '-o',
          'debug=true'
        ]);

        const isOutputRendered = await waitForOutput(/Run ID: run-\d+/);
        expect(isOutputRendered).toBe(true);

        // Verify API was called with options
        const calls = env.server.getLogs();
        const runCall = calls.find(c => c.method === 'createBrainRun');
        expect(runCall).toBeDefined();
        expect(runCall?.args[0]).toBe('test-brain');
        expect(runCall?.args[1]).toEqual({
          channel: '#general',
          debug: 'true'
        });
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should run a brain with options using long flag', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'run',
          'test-brain',
          '--options',
          'environment=production',
          '--options',
          'rate=100'
        ]);
        
        const isOutputRendered = await waitForOutput(/Run ID: run-\d+/);
        expect(isOutputRendered).toBe(true);
        
        // Verify API was called with options
        const calls = env.server.getLogs();
        const runCall = calls.find(c => c.method === 'createBrainRun');
        expect(runCall).toBeDefined();
        expect(runCall?.args[0]).toBe('test-brain');
        expect(runCall?.args[1]).toEqual({
          environment: 'production',
          rate: '100'
        });
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle invalid option format', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // This will throw an error during yargs coercion
        await expect(px([
          'run', 
          'test-brain', 
          '-o', 
          'invalid-no-equals'
        ])).rejects.toThrow(/Invalid option format: "invalid-no-equals"/);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle options with values containing equals signs', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'run',
          'test-brain',
          '-o',
          'webhook=https://example.com/api?key=value&foo=bar'
        ]);

        const isOutputRendered = await waitForOutput(/Run ID: run-\d+/);
        expect(isOutputRendered).toBe(true);

        // Verify API was called with correct URL value
        const calls = env.server.getLogs();
        const runCall = calls.find(c => c.method === 'createBrainRun');
        expect(runCall).toBeDefined();
        expect(runCall?.args[1]).toEqual({
          webhook: 'https://example.com/api?key=value&foo=bar'
        });
      } finally {
        await env.stopAndCleanup();
      }
    });


    it('should handle brain not found error with helpful message', async () => {
      const env = await createTestEnv();
      // Don't add any brains - search will return empty results
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['run', 'non-existent-brain']);

        // Check for error component output - now shows "No brains found matching"
        const foundErrorTitle = await waitForOutput(/Brain Not Found/i, 30);
        expect(foundErrorTitle).toBe(true);

        const foundErrorMessage = await waitForOutput(/No brains found matching 'non-existent-brain'/i, 30);
        expect(foundErrorMessage).toBe(true);

        const foundHelpText = await waitForOutput(/brain name is spelled correctly/i, 30);
        expect(foundHelpText).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle API server error on search', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors and set up error mock
        nock.cleanAll();
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get('/brains')
          .query(true)
          .reply(500, 'Internal Server Error');

        const { waitForOutput } = await px(['run', 'test-brain']);

        // Should show server error
        const foundError = await waitForOutput(/Server Error|Error searching/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle network connection errors (ECONNREFUSED)', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors and set up error mock
        nock.cleanAll();
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get('/brains')
          .query(true)
          .replyWithError({
            message: 'connect ECONNREFUSED',
            code: 'ECONNREFUSED',
          });

        const { waitForOutput } = await px(['run', 'test-brain']);

        // Should show connection error
        const foundError = await waitForOutput(/Connection Error|Error connecting/i, 30);
        expect(foundError).toBe(true);
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

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      // Add a running brain run
      server.addBrainRun({
        brainRunId: 'run-active-123',
        brainTitle: 'test-brain',
        type: 'START',
        status: STATUS.RUNNING,
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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      // Add multiple running brain runs
      server.addBrainRun({
        brainRunId: 'run-active-1',
        brainTitle: 'test-brain',
        type: 'START',
        status: STATUS.RUNNING,
        createdAt: Date.now() - 120000, // 2 minutes ago
        startedAt: Date.now() - 120000,
      });

      server.addBrainRun({
        brainRunId: 'run-active-2',
        brainTitle: 'test-brain',
        type: 'START',
        status: STATUS.RUNNING,
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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the brain search to return the brain, and active-runs to return 500
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get(/^\/brains\?q=/)
          .reply(200, {
            brains: [{ title: 'test-brain', description: 'A test brain' }],
            count: 1,
          });

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
          'You must provide either a brain identifier or a --run-id'
        );
      } finally {
        await env.stopAndCleanup();
      }
    });


    it('should display step statuses correctly', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'watch',
          '--run-id',
          'test-multi-status',
        ]);

        // New watch shows 3 steps at a time (prev/current/next)
        // Check that the brain title is shown
        const foundTitle = await waitForOutput(/Multi Status Brain/);
        expect(foundTitle).toBe(true);

        // Check that at least one step is shown (the running one should be visible)
        const foundRunning = await waitForOutput(/•.*Running Step/);
        expect(foundRunning).toBe(true);

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
        filename: 'daily-report',
        title: 'Daily Report Generator',
        description: 'Generates daily reports from various data sources',
        createdAt: Date.now() - 86400000,
        lastModified: Date.now() - 3600000,
      });
      
      server.addBrain({
        filename: 'data-processor',
        title: 'Data Processing Pipeline',
        description: 'Processes incoming data and transforms it',
        createdAt: Date.now() - 172800000,
        lastModified: Date.now() - 7200000,
      });
      
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['list']);

        // Wait for brains to appear (check for title, not filename)
        const foundBrains = await waitForOutput(/Daily Report Generator/i, 30);
        expect(foundBrains).toBe(true);

        // Check that titles and descriptions are shown
        const output = instance.lastFrame() || '';
        expect(output).toContain('Daily Report Generator');
        expect(output).toContain('Data Processing Pipeline');
        expect(output).toContain('Generates daily reports');
        expect(output).toContain('Processes incoming data');

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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      // Add some brain runs to history
      server.addBrainRun({
        brainRunId: 'run-123',
        brainTitle: 'test-brain',
        brainDescription: 'A test brain',
        type: 'START',
        status: STATUS.COMPLETE,
        createdAt: Date.now() - 3600000, // 1 hour ago
        startedAt: Date.now() - 3600000,
        completedAt: Date.now() - 3540000, // 1 minute duration
      });

      server.addBrainRun({
        brainRunId: 'run-456',
        brainTitle: 'test-brain',
        type: 'START',
        status: STATUS.ERROR,
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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the brain search to return the brain, and history to return 500
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get(/^\/brains\?q=/)
          .reply(200, {
            brains: [{ title: 'test-brain', description: 'A test brain' }],
            count: 1,
          });

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

  describe('show command (run details)', () => {
    it('should show run details for a completed run', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add a completed brain run
      server.addBrainRun({
        brainRunId: 'run-completed-123',
        brainTitle: 'Test Brain',
        brainDescription: 'A test brain',
        type: 'brain:complete',
        status: STATUS.COMPLETE,
        createdAt: Date.now() - 60000,
        startedAt: Date.now() - 60000,
        completedAt: Date.now(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', '--run-id', 'run-completed-123']);

        // Check for run ID
        const foundRunId = await waitForOutput(/run-completed-123/, 30);
        expect(foundRunId).toBe(true);

        // Check for brain title
        const foundTitle = await waitForOutput(/Test Brain/, 30);
        expect(foundTitle).toBe(true);

        // Check for status (lowercase)
        const foundStatus = await waitForOutput(/complete/, 30);
        expect(foundStatus).toBe(true);

        // Check for success message
        const foundSuccess = await waitForOutput(/completed successfully/, 30);
        expect(foundSuccess).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error details for a failed run', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add a failed brain run with error details
      server.addBrainRun({
        brainRunId: 'run-error-456',
        brainTitle: 'Failing Brain',
        type: 'brain:error',
        status: STATUS.ERROR,
        error: {
          name: 'AnthropicError',
          message: 'Rate limit exceeded',
          stack: 'Error: Rate limit exceeded\n    at processStep (/src/brain.ts:123)\n    at runBrain (/src/runner.ts:45)',
        },
        createdAt: Date.now() - 120000,
        startedAt: Date.now() - 120000,
        completedAt: Date.now() - 60000,
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', '--run-id', 'run-error-456']);

        // Check for run ID
        const foundRunId = await waitForOutput(/run-error-456/, 30);
        expect(foundRunId).toBe(true);

        // Check for error status (lowercase)
        const foundStatus = await waitForOutput(/error/, 30);
        expect(foundStatus).toBe(true);

        // Check for error type
        const foundErrorType = await waitForOutput(/AnthropicError/, 30);
        expect(foundErrorType).toBe(true);

        // Check for error message
        const foundErrorMessage = await waitForOutput(/Rate limit exceeded/, 30);
        expect(foundErrorMessage).toBe(true);

        // Check for stack trace
        const foundStackTrace = await waitForOutput(/Stack Trace/, 30);
        expect(foundStackTrace).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error when run does not exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', '--run-id', 'non-existent-run']);
        const foundError = await waitForOutput(/not found/, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show options when present', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add a run with options
      server.addBrainRun({
        brainRunId: 'run-with-options',
        brainTitle: 'Configurable Brain',
        type: 'brain:complete',
        status: STATUS.COMPLETE,
        options: {
          email: 'test@example.com',
          verbose: 'true',
        },
        createdAt: Date.now() - 60000,
        startedAt: Date.now() - 60000,
        completedAt: Date.now(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['show', '--run-id', 'run-with-options']);

        // Check for options section
        const foundOptions = await waitForOutput(/Options/, 30);
        expect(foundOptions).toBe(true);

        // Check for option values
        const foundEmail = await waitForOutput(/test@example.com/, 30);
        expect(foundEmail).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('brain rerun command', () => {
    it('should successfully rerun a brain without specific run ID', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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

        // Check for error title (now from BrainResolver)
        const foundErrorTitle = await waitForOutput(/Brain Not Found/i, 30);
        expect(foundErrorTitle).toBe(true);

        // Check for error message
        const foundErrorMessage = await waitForOutput(/No brains found matching 'non-existent-brain'/i, 30);
        expect(foundErrorMessage).toBe(true);

        // Check for helpful details
        const foundDetails = await waitForOutput(/positronic list/i, 30);
        expect(foundDetails).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle run ID not found error', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

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

        // Check for connection error (now from BrainResolver)
        const foundErrorTitle = await waitForOutput(/Connection Error/i, 30);
        expect(foundErrorTitle).toBe(true);

        const foundConnectionError = await waitForOutput(/Error connecting to the local development server/i, 30);
        expect(foundConnectionError).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    it('should handle API server errors', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add brain to mock server for fuzzy search resolution
      server.addBrain({
        filename: 'test-brain',
        title: 'test-brain',
        description: 'A test brain for testing',
        createdAt: Date.now(),
        lastModified: Date.now(),
      });

      const px = await env.start();

      try {
        // Clear all existing nock interceptors to avoid conflicts
        nock.cleanAll();

        // Mock the brain search to return the brain, and rerun to return 500
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .get(/^\/brains\?q=/)
          .reply(200, {
            brains: [{ title: 'test-brain', description: 'A test brain' }],
            count: 1,
          });

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
