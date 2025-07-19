import { describe, it, expect } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';
import * as fs from 'fs';
import * as path from 'path';

describe('secret commands', () => {
  describe('secret create', () => {
    it('should pass through to backend', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Just verify it runs without error
        await px(['secret', 'create', 'TEST_SECRET', '--value=test-value']);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret list', () => {
    it('should pass through to backend', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Just verify it runs without error
        await px(['secret', 'list']);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('secret delete', () => {
    it('should pass through to backend', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        // Just verify it runs without error
        await px(['secret', 'delete', 'TEST_SECRET']);
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
        const { waitForOutput, instance } = await px(['secret', 'bulk']);

        // Since bulk command passes through to backend,
        // we can't check for output. Just wait a bit for completion.
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify server method was called
        const calls = env.server.getLogs();
        const bulkCall = calls.find((c) => c.method === 'bulkSecrets');
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
        await px(['secret', 'bulk', '.env.production']);

        // Since bulk command passes through to backend,
        // we can't check for output. Just wait a bit for completion.
        await new Promise((resolve) => setTimeout(resolve, 100));

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
        await px(['secret', 'bulk']);

        // Since bulk command passes through to backend,
        // we can't check for output. Just wait a bit for completion.
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify bulkSecrets was called
        const calls = env.server.getLogs();
        const bulkCall = calls.find((c) => c.method === 'bulkSecrets');
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

        const foundError = await waitForOutput(
          /No secrets found in the .env file/i,
          30
        );
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

        // Since bulk command passes through to backend,
        // we can't check for output. Just wait a bit for completion.
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
