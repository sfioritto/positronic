import { describe, it, expect } from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';

describe('store command', () => {
  describe('brain list (level 1)', () => {
    it('should show empty state when no store data exists', async () => {
      const env = await createTestEnv();
      const px = await env.start();

      try {
        const { waitForOutput } = await px(['store']);

        const foundEmpty = await waitForOutput(
          /No brains with store data found/i,
          30
        );
        expect(foundEmpty).toBe(true);

        // Verify API call
        const calls = env.server.getLogs();
        const listCall = calls.find((c) => c.method === 'listStoreBrains');
        expect(listCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should display brains with store data', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addStoreEntry({
        brainTitle: 'email-digest',
        key: 'settings',
        scope: 'shared',
        value: { theme: 'dark' },
        size: 20,
        lastModified: new Date().toISOString(),
      });

      server.addStoreEntry({
        brainTitle: 'data-sync',
        key: 'last-run',
        scope: 'shared',
        value: { timestamp: 123 },
        size: 15,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput } = await px(['store']);

        const foundCount = await waitForOutput(/2 brains/i, 30);
        expect(foundCount).toBe(true);

        const foundEmailDigest = await waitForOutput(/email-digest/i, 30);
        expect(foundEmailDigest).toBe(true);

        const foundDataSync = await waitForOutput(/data-sync/i, 30);
        expect(foundDataSync).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('key list (level 2)', () => {
    it('should show keys when drilling into a brain', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addStoreEntry({
        brainTitle: 'test-brain',
        key: 'settings',
        scope: 'shared',
        value: { theme: 'dark' },
        size: 20,
        lastModified: new Date().toISOString(),
      });

      server.addStoreEntry({
        brainTitle: 'test-brain',
        key: 'prefs',
        scope: 'user',
        userName: 'user-1',
        value: { lang: 'en' },
        size: 12,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['store']);

        // Wait for brains list to load
        const foundBrain = await waitForOutput(/test-brain/i, 30);
        expect(foundBrain).toBe(true);

        // Press Enter to drill into the brain
        instance.stdin.write('\r');

        // Wait for keys to load
        const foundSettings = await waitForOutput(/settings/i, 30);
        expect(foundSettings).toBe(true);

        const foundPrefs = await waitForOutput(/prefs/i, 30);
        expect(foundPrefs).toBe(true);

        // Verify it shows scope info
        const foundShared = await waitForOutput(/shared/i, 30);
        expect(foundShared).toBe(true);

        // Verify API calls
        const calls = env.server.getLogs();
        const keysCall = calls.find((c) => c.method === 'listStoreKeys');
        expect(keysCall).toBeDefined();
        expect(keysCall?.args[0]).toBe('test-brain');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show empty state for brain with no keys', async () => {
      const env = await createTestEnv();
      const { server } = env;

      // Add a brain that shows up in the list but has no keys
      server.addStoreEntry({
        brainTitle: 'empty-brain',
        key: 'temp',
        scope: 'shared',
        value: {},
        size: 2,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['store']);

        // Wait for brain list
        const foundBrain = await waitForOutput(/empty-brain/i, 30);
        expect(foundBrain).toBe(true);

        // Clear the entries before drilling in
        server.clearStoreEntries();

        // Press Enter to drill in
        instance.stdin.write('\r');

        // Should show empty state
        const foundEmpty = await waitForOutput(/No keys found/i, 30);
        expect(foundEmpty).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('value view (level 3)', () => {
    it('should display JSON value when selecting a key', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addStoreEntry({
        brainTitle: 'test-brain',
        key: 'config',
        scope: 'shared',
        value: { maxRetries: 3, timeout: 5000 },
        size: 30,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['store']);

        // Wait for brains list
        const foundBrain = await waitForOutput(/test-brain/i, 30);
        expect(foundBrain).toBe(true);

        // Drill into brain
        instance.stdin.write('\r');

        // Wait for keys list
        const foundKey = await waitForOutput(/config/i, 30);
        expect(foundKey).toBe(true);

        // Drill into key
        instance.stdin.write('\r');

        // Should display JSON value
        const foundValue = await waitForOutput(/maxRetries/i, 30);
        expect(foundValue).toBe(true);

        const foundTimeout = await waitForOutput(/5000/i, 30);
        expect(foundTimeout).toBe(true);

        // Verify API call
        const calls = env.server.getLogs();
        const valueCall = calls.find((c) => c.method === 'getSharedValue');
        expect(valueCall).toBeDefined();
        expect(valueCall?.args).toEqual(['test-brain', 'config']);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('navigation', () => {
    it('should navigate back from keys to brains', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addStoreEntry({
        brainTitle: 'test-brain',
        key: 'data',
        scope: 'shared',
        value: {},
        size: 2,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['store']);

        // Wait for brains list
        await waitForOutput(/test-brain/i, 30);

        // Drill into brain
        instance.stdin.write('\r');

        // Wait for keys
        await waitForOutput(/data/i, 30);

        // Press 'b' to go back
        instance.stdin.write('b');

        // Should be back at brain list
        const foundExplorer = await waitForOutput(/Store Explorer/i, 30);
        expect(foundExplorer).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('delete', () => {
    it('should delete a key after confirmation', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addStoreEntry({
        brainTitle: 'test-brain',
        key: 'to-delete',
        scope: 'shared',
        value: { temp: true },
        size: 10,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['store']);

        // Wait for brains list and drill in
        await waitForOutput(/test-brain/i, 30);
        instance.stdin.write('\r');

        // Wait for keys list
        await waitForOutput(/to-delete/i, 30);

        // Press 'd' to start delete
        instance.stdin.write('d');

        // Should show confirmation
        const foundConfirm = await waitForOutput(/Delete.*to-delete/i, 50);
        expect(foundConfirm).toBe(true);

        // Confirm with 'y'
        instance.stdin.write('y');

        // Should show deletion message (async delete needs more time)
        const foundDeleted = await waitForOutput(/Deleted/i, 50);
        expect(foundDeleted).toBe(true);

        // Verify API call
        const calls = env.server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deleteSharedKey');
        expect(deleteCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should cancel delete on n', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addStoreEntry({
        brainTitle: 'test-brain',
        key: 'keep-me',
        scope: 'shared',
        value: { keep: true },
        size: 10,
        lastModified: new Date().toISOString(),
      });

      const px = await env.start();

      try {
        const { waitForOutput, instance } = await px(['store']);

        // Drill into brain
        await waitForOutput(/test-brain/i, 30);
        instance.stdin.write('\r');
        await waitForOutput(/keep-me/i, 30);

        // Start delete
        instance.stdin.write('d');
        const foundDeletePrompt = await waitForOutput(/Delete.*keep-me/i, 50);
        expect(foundDeletePrompt).toBe(true);

        // Cancel
        instance.stdin.write('n');

        // Should still show the key (back to normal footer)
        const foundNormal = await waitForOutput(/d delete/i, 50);
        expect(foundNormal).toBe(true);

        // No delete call should have been made
        const calls = env.server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deleteSharedKey');
        expect(deleteCall).toBeUndefined();
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('connection error', () => {
    it('should handle server connection errors', async () => {
      const env = await createTestEnv();
      // Don't start the server to simulate connection error

      try {
        const { waitForOutput } = await px(['store'], {
          server: env.server,
        });

        const foundError = await waitForOutput(
          /Error connecting|Connection Error/i,
          30
        );
        expect(foundError).toBe(true);
      } finally {
        env.cleanup();
      }
    });
  });
});
