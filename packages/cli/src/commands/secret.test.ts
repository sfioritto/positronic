import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';
import nock from 'nock';

describe('secret commands', () => {

  describe('secret create', () => {
    it('should create a new secret with provided value', async () => {
      const env = await createTestEnv();
      const { server } = env;

      const secretName = 'ANTHROPIC_API_KEY';
      const secretValue = 'sk-ant-test-123';

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          secretName,
          `--value=${secretValue}`,
        ]);

        // Check for success message
        const foundSuccess = await waitForOutput(/Secret created successfully!/i, 30);
        expect(foundSuccess).toBe(true);

        // Check that the secret name is displayed
        const foundName = await waitForOutput(new RegExp(secretName), 30);
        expect(foundName).toBe(true);

        // Verify API call
        const calls = server.getLogs();
        const createCall = calls.find((c) => c.method === 'createSecret');
        expect(createCall).toBeDefined();
        expect(createCall?.args[0]).toBe(secretName);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show warning when value is provided via command line', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'API_KEY',
          '--value=test-value',
        ]);

        // Check for warning about shell history
        const foundWarning = await waitForOutput(/shell history/i, 30);
        expect(foundWarning).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'API_KEY',
          '--value=test-value',
        ], {
          server: env.server,
        });

        const foundError = await waitForOutput(
          /Error connecting to the local development server/i,
          30
        );
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    it('should handle API server errors', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors
        nock.cleanAll();

        // Mock the server to return a 500 error
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .post('/secrets')
          .reply(500, { error: 'Internal Server Error' });

        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'API_KEY',
          '--value=test-value',
        ]);

        // The ErrorComponent will display the error
        const foundError = await waitForOutput(/Error:|Failed|500/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle duplicate secret creation', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Pre-populate a secret
      server.addSecret('EXISTING_KEY', 'old-value');

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'EXISTING_KEY',
          '--value=new-value',
        ]);

        // Should still succeed (update behavior)
        const foundSuccess = await waitForOutput(/Secret created successfully!/i, 30);
        expect(foundSuccess).toBe(true);

        // Verify the secret was updated
        const secret = server.getSecret('EXISTING_KEY');
        expect(secret).toBeDefined();
        expect(secret?.value).toBe('new-value');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should validate secret name format', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Clear all existing nock interceptors
        nock.cleanAll();

        // Mock the server to return a 400 error for invalid name
        const port = env.server.port;
        nock(`http://localhost:${port}`)
          .post('/secrets')
          .reply(400, { error: 'Invalid secret name format' });

        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'invalid name with spaces',
          '--value=test-value',
        ]);

        const foundError = await waitForOutput(/Error:|Invalid|400/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    // Note: Testing interactive input is challenging with the current setup
    // as it requires simulating keyboard input. For now, we focus on
    // testing the --value flag approach.
  });
});