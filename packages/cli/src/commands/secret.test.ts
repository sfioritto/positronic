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

        // Verify server method call
        const calls = server.getLogs();
        const setSecretCall = calls.find((c) => c.method === 'setSecret');
        expect(setSecretCall).toBeDefined();
        expect(setSecretCall?.args[0]).toBe(secretName);
        expect(setSecretCall?.args[1]).toBe(secretValue);
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

    it('should handle when no project is found', async () => {
      const env = await createTestEnv();
      // Don't pass server to simulate no project found

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'API_KEY',
          '--value=test-value',
        ], {
          server: undefined,
        });

        const foundError = await waitForOutput(
          /No project found/i,
          30
        );
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    it('should handle server method errors', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Mock setSecret to throw an error
      server.setSecret = jest.fn<Promise<void>, [string, string]>().mockRejectedValue(new Error('Failed to set secret: wrangler error'));
      
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'API_KEY',
          '--value=test-value',
        ]);

        // The ErrorComponent will display the error
        const foundError = await waitForOutput(/Failed to create secret/i, 30);
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

    it('should handle wrangler errors for invalid names', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Mock setSecret to throw an error for invalid name
      server.setSecret = jest.fn<Promise<void>, [string, string]>().mockRejectedValue(new Error('Failed to set secret: invalid secret name'));
      
      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px([
          'secret',
          'create',
          'invalid name with spaces',
          '--value=test-value',
        ]);

        const foundError = await waitForOutput(/Failed to create secret/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    // Note: Testing interactive input is challenging with the current setup
    // as it requires simulating keyboard input. For now, we focus on
    // testing the --value flag approach.
  });

  describe('secret list', () => {
    it('should list all secrets', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Pre-populate some secrets
      server.addSecret('API_KEY_1', 'value1');
      server.addSecret('API_KEY_2', 'value2');
      server.addSecret('DATABASE_URL', 'postgres://...');

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'list']);

        // Check for secrets header
        const foundHeader = await waitForOutput(/Secrets \(3\)/i, 30);
        expect(foundHeader).toBe(true);

        // Check for each secret name
        const foundKey1 = await waitForOutput(/API_KEY_1/i, 30);
        expect(foundKey1).toBe(true);

        const foundKey2 = await waitForOutput(/API_KEY_2/i, 30);
        expect(foundKey2).toBe(true);

        const foundDb = await waitForOutput(/DATABASE_URL/i, 30);
        expect(foundDb).toBe(true);

        // Verify server method call
        const calls = server.getLogs();
        const listCall = calls.find((c) => c.method === 'listSecrets');
        expect(listCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show empty state when no secrets exist', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'list']);

        const foundEmpty = await waitForOutput(/No secrets found/i, 30);
        expect(foundEmpty).toBe(true);

        const foundTip = await waitForOutput(/Use "px secret create/i, 30);
        expect(foundTip).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle when no project is found', async () => {
      const env = await createTestEnv();

      try {
        const { waitForOutput } = await px(['secret', 'list'], {
          server: undefined,
        });

        const foundError = await waitForOutput(/No project found/i, 30);
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });
  });

  describe('secret delete', () => {
    it('should delete an existing secret', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Pre-populate a secret
      server.addSecret('TO_DELETE', 'value');

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'delete', 'TO_DELETE']);

        // Check for success message
        const foundSuccess = await waitForOutput(/Secret "TO_DELETE" deleted successfully/i, 30);
        expect(foundSuccess).toBe(true);

        // Verify server method call
        const calls = server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deleteSecret');
        expect(deleteCall).toBeDefined();
        expect(deleteCall?.args[0]).toBe('TO_DELETE');

        // Verify secret was actually deleted
        expect(server.getSecret('TO_DELETE')).toBeUndefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle deleting non-existent secret', async () => {
      const env = await createTestEnv();
      const { server } = env;
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'delete', 'DOES_NOT_EXIST']);

        // Check for not found message
        const foundNotFound = await waitForOutput(/Secret "DOES_NOT_EXIST" not found/i, 30);
        expect(foundNotFound).toBe(true);

        // Verify server method call
        const calls = server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deleteSecret');
        expect(deleteCall).toBeDefined();
        expect(deleteCall?.args[0]).toBe('DOES_NOT_EXIST');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle when no project is found', async () => {
      const env = await createTestEnv();

      try {
        const { waitForOutput } = await px(['secret', 'delete', 'SOME_KEY'], {
          server: undefined,
        });

        const foundError = await waitForOutput(/No project found/i, 30);
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    it('should handle server method errors', async () => {
      const env = await createTestEnv();
      const { server } = env;
      
      // Mock deleteSecret to throw an error
      server.deleteSecret = jest.fn<Promise<boolean>, [string]>().mockRejectedValue(new Error('Failed to delete secret: wrangler error'));
      
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'delete', 'SOME_KEY']);

        const foundError = await waitForOutput(/Failed to delete secret/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});