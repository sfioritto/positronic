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
        await px([
          'secret',
          'create',
          'TEST_SECRET',
          '--value=test-value',
        ]);
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

  describe('secret sync', () => {
    it('should sync secrets from .env file', async () => {
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
        const { waitForOutput, instance } = await px(['secret', 'sync']);

        // Check for success message
        const foundSuccess = await waitForOutput(/Secrets synced successfully!/i, 30);
        expect(foundSuccess).toBe(true);

        // Check for created count
        const foundCreated = await waitForOutput(/Created: 3 secrets/i, 30);
        expect(foundCreated).toBe(true);

        // Verify server method was called
        const calls = env.server.getLogs();
        const syncCall = calls.find((c) => c.method === 'syncSecrets');
        expect(syncCall).toBeDefined();
        expect(syncCall?.args[1]).toBe(false); // dryRun = false
        
        // Verify the server received the correct secret names
        const secrets = env.server.getSecrets();
        expect(secrets.length).toBe(3);
        const secretNames = secrets.map(s => s.name);
        expect(secretNames).toContain('TEST_API_KEY');
        expect(secretNames).toContain('TEST_DATABASE_URL');
        expect(secretNames).toContain('TEST_REDIS_URL');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should sync from custom file path', async () => {
      const env = await createTestEnv();
      
      // Create a test .env.secrets file
      env.setup((dir: string) => {
        const envContent = `SECRET_KEY=my-secret-key
API_TOKEN=token123`;
        fs.writeFileSync(path.join(dir, '.env.secrets'), envContent);
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'sync', '--file', '.env.secrets']);

        const foundSuccess = await waitForOutput(/Secrets synced successfully!/i, 30);
        expect(foundSuccess).toBe(true);

        const foundCreated = await waitForOutput(/Created: 2 secrets/i, 30);
        expect(foundCreated).toBe(true);

        const calls = env.server.getLogs();
        const syncCall = calls.find((c) => c.method === 'syncSecrets');
        expect(syncCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show dry run preview', async () => {
      const env = await createTestEnv();
      
      env.setup((dir: string) => {
        const envContent = `KEY1=value1
KEY2=value2
KEY3=value3`;
        fs.writeFileSync(path.join(dir, '.env'), envContent);
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'sync', '--dry-run']);

        // Check for dry run message
        const foundDryRun = await waitForOutput(/Dry run: Secrets found in/i, 30);
        expect(foundDryRun).toBe(true);

        // Check for secret names
        const foundKey1 = await waitForOutput(/KEY1/i, 30);
        expect(foundKey1).toBe(true);
        
        const foundTotal = await waitForOutput(/Total: 3 secrets/i, 30);
        expect(foundTotal).toBe(true);

        // Verify syncSecrets was called with dryRun = true
        const calls = env.server.getLogs();
        const syncCall = calls.find((c) => c.method === 'syncSecrets');
        expect(syncCall).toBeDefined();
        expect(syncCall?.args[1]).toBe(true); // dryRun = true
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle file not found error', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'sync', '--file', 'nonexistent.env']);

        const foundError = await waitForOutput(/Error: File not found/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle empty env file', async () => {
      const env = await createTestEnv();
      
      env.setup((dir: string) => {
        // Create empty file
        fs.writeFileSync(path.join(dir, '.env'), '');
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['secret', 'sync']);

        const foundError = await waitForOutput(/No secrets found in the file/i, 30);
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
        const { waitForOutput } = await px(['secret', 'sync']);

        const foundSuccess = await waitForOutput(/Secrets synced successfully!/i, 30);
        expect(foundSuccess).toBe(true);

        const foundCreated = await waitForOutput(/Created: 1 secret/i, 30);
        expect(foundCreated).toBe(true);

        const foundUpdated = await waitForOutput(/Updated: 1 secret/i, 30);
        expect(foundUpdated).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});