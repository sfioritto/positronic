import { describe, it, expect } from '@jest/globals';
import { createTestEnv } from './test-utils.js';
import * as fs from 'fs';
import * as path from 'path';

describe('secret commands', () => {
  describe('secret create', () => {
    it('should create a secret via API', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'secret',
          'create',
          'TEST_SECRET',
          '--value=test-value',
        ]);

        const foundSuccess = await waitForOutput(
          /Secret created successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        // Verify API was called
        const calls = env.server.getLogs();
        const createCall = calls.find((c) => c.method === 'createSecret');
        expect(createCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret list', () => {
    it('should list secrets from API', async () => {
      const env = await createTestEnv();

      // Add some test secrets
      env.server.addSecret('API_KEY', 'secret-value');
      env.server.addSecret('DATABASE_URL', 'db-connection-string');

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'list']);

        const foundSecrets = await waitForOutput(/Found 2 secrets/i, 30);
        expect(foundSecrets).toBe(true);

        // Verify API was called
        const calls = env.server.getLogs();
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
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret delete', () => {
    it('should delete a secret via API', async () => {
      const env = await createTestEnv();

      // Add a secret to delete
      env.server.addSecret('TEST_SECRET', 'secret-value');

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'delete', 'TEST_SECRET']);

        const foundSuccess = await waitForOutput(
          /Secret deleted successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        // Verify API was called
        const calls = env.server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deleteSecret');
        expect(deleteCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret bulk', () => {
    it('should bulk upload secrets from .env file', async () => {
      const env = await createTestEnv();

      // Create a test .env file
      env.setup((dir: string) => {
        const envContent = `TEST_API_KEY=sk-test123
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db
TEST_REDIS_URL=redis://localhost:6379`;
        fs.writeFileSync(path.join(dir, '.env'), envContent);
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'bulk']);

        const foundSuccess = await waitForOutput(
          /Secrets uploaded successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        // Verify the API was called with bulk create
        const calls = env.server.getLogs();
        const bulkCall = calls.find((c) => c.method === 'bulkCreateSecrets');
        expect(bulkCall).toBeDefined();

        // Verify the server received the correct secret names
        const secrets = env.server.getSecrets();
        expect(secrets.length).toBe(3);
        const secretNames = secrets.map((s) => s.name);
        expect(secretNames).toContain('TEST_API_KEY');
        expect(secretNames).toContain('TEST_DATABASE_URL');
        expect(secretNames).toContain('TEST_REDIS_URL');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle custom .env file path', async () => {
      const env = await createTestEnv();

      env.setup((dir: string) => {
        const envContent = `SECRET_KEY=my-secret-key
API_TOKEN=token123`;
        fs.writeFileSync(path.join(dir, '.env.production'), envContent);
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'secret',
          'bulk',
          '.env.production',
        ]);

        const foundSuccess = await waitForOutput(
          /Secrets uploaded successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        // Verify the server received the correct secret names
        const secrets = env.server.getSecrets();
        expect(secrets.length).toBe(2);
        const secretNames = secrets.map((s) => s.name);
        expect(secretNames).toContain('SECRET_KEY');
        expect(secretNames).toContain('API_TOKEN');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle successful bulk upload', async () => {
      const env = await createTestEnv();

      env.setup((dir: string) => {
        const envContent = `KEY1=value1
KEY2=value2
KEY3=value3`;
        fs.writeFileSync(path.join(dir, '.env'), envContent);
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'bulk']);

        const foundSuccess = await waitForOutput(
          /Secrets uploaded successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        // Verify bulkCreateSecrets was called
        const calls = env.server.getLogs();
        const bulkCall = calls.find((c) => c.method === 'bulkCreateSecrets');
        expect(bulkCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle file not found error', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px([
          'secret',
          'bulk',
          'nonexistent.env',
        ]);

        const foundError = await waitForOutput(/No .env file found/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle empty .env file', async () => {
      const env = await createTestEnv();

      env.setup((dir: string) => {
        // Create empty .env file
        fs.writeFileSync(path.join(dir, '.env'), '');
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'bulk']);

        const foundError = await waitForOutput(/No secrets found/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle mixed create/update results', async () => {
      const env = await createTestEnv();

      // Pre-create a secret so we can test update behavior
      env.server.addSecret('EXISTING_KEY', 'old-value');

      env.setup((dir: string) => {
        const envContent = `NEW_KEY=new-value
EXISTING_KEY=updated-value`;
        fs.writeFileSync(path.join(dir, '.env'), envContent);
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'bulk']);

        const foundSuccess = await waitForOutput(
          /Secrets uploaded successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        // Verify the secrets were created/updated
        const secrets = env.server.getSecrets();
        expect(secrets.length).toBe(2);

        const existingSecret = secrets.find((s) => s.name === 'EXISTING_KEY');
        expect(existingSecret?.value).toBe('updated-value');
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
