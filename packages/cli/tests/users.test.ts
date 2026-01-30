import {
  describe,
  it,
  expect,
} from '@jest/globals';
import { createTestEnv, px } from './test-utils.js';
import nock from 'nock';

describe('users command', () => {
  describe('users list', () => {
    it('should show message when no users exist', async () => {
      const env = await createTestEnv();
      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn(['users', 'list']);

        const foundMessage = await waitForOutput(/No users found/i, 30);
        expect(foundMessage).toBe(true);

        const output = instance.lastFrame() || '';
        expect(output).toContain('px users create');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should list users when users exist', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addUser({
        id: 'user-123',
        name: 'admin',
        createdAt: Date.now(),
      });
      server.addUser({
        id: 'user-456',
        name: 'alice',
        createdAt: Date.now() - 1000,
      });

      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn(['users', 'list']);

        const foundUsers = await waitForOutput(/Found 2 users/i, 30);
        expect(foundUsers).toBe(true);

        const output = instance.lastFrame() || '';
        expect(output).toContain('admin');
        expect(output).toContain('alice');

        const calls = server.getLogs();
        const listCall = calls.find((c) => c.method === 'listUsers');
        expect(listCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors gracefully', async () => {
      const env = await createTestEnv();
      // Block real network to ensure connection error (prevents hitting local dev servers)
      nock.disableNetConnect();

      try {
        const { waitForOutput } = await px(['users', 'list'], {
          server: env.server,
        });

        const foundError = await waitForOutput(
          /Error connecting to the local development server/i
        );
        expect(foundError).toBe(true);
      } finally {
        nock.enableNetConnect();
        env.cleanup();
      }
    });
  });

  describe('users create', () => {
    it('should create a new user', async () => {
      const env = await createTestEnv();
      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn([
          'users',
          'create',
          'admin',
        ]);

        const foundSuccess = await waitForOutput(
          /User created successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        const output = instance.lastFrame() || '';
        expect(output).toContain('admin');

        const calls = env.server.getLogs();
        const createCall = calls.find((c) => c.method === 'createUser');
        expect(createCall).toBeDefined();
        expect(createCall!.args[0]).toBe('admin');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should handle server connection errors gracefully', async () => {
      const env = await createTestEnv();
      // Block real network to ensure connection error (prevents hitting local dev servers)
      nock.disableNetConnect();

      try {
        const { waitForOutput } = await px(['users', 'create', 'admin'], {
          server: env.server,
        });

        const foundError = await waitForOutput(
          /Error connecting to the local development server/i
        );
        expect(foundError).toBe(true);
      } finally {
        nock.enableNetConnect();
        env.cleanup();
      }
    });
  });

  describe('users delete', () => {
    it('should delete a user with --force', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addUser({
        id: 'user-123',
        name: 'admin',
        createdAt: Date.now(),
      });

      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn([
          'users',
          'delete',
          'user-123',
          '--force',
        ]);

        const foundSuccess = await waitForOutput(/deleted successfully/i, 30);
        expect(foundSuccess).toBe(true);

        const calls = server.getLogs();
        const deleteCall = calls.find((c) => c.method === 'deleteUser');
        expect(deleteCall).toBeDefined();
        expect(deleteCall!.args[0]).toBe('user-123');
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should show error when user not found', async () => {
      const env = await createTestEnv();
      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn([
          'users',
          'delete',
          'nonexistent',
          '--force',
        ]);

        const foundError = await waitForOutput(/not found/i, 30);
        expect(foundError).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('users keys list', () => {
    it('should show message when no keys exist', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addUser({
        id: 'user-123',
        name: 'admin',
        createdAt: Date.now(),
      });

      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn([
          'users',
          'keys',
          'list',
          'user-123',
        ]);

        const foundMessage = await waitForOutput(/No keys found/i, 30);
        expect(foundMessage).toBe(true);
      } finally {
        await env.stopAndCleanup();
      }
    });

    it('should list keys when keys exist', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addUser({
        id: 'user-123',
        name: 'admin',
        createdAt: Date.now(),
      });
      server.addUserKey({
        fingerprint: 'SHA256:abc123',
        userId: 'user-123',
        label: 'laptop',
        addedAt: Date.now(),
      });

      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn([
          'users',
          'keys',
          'list',
          'user-123',
        ]);

        const foundKeys = await waitForOutput(/1 key/i, 30);
        expect(foundKeys).toBe(true);

        const output = instance.lastFrame() || '';
        expect(output).toContain('SHA256:abc123');
        expect(output).toContain('laptop');
      } finally {
        await env.stopAndCleanup();
      }
    });
  });

  describe('users keys remove', () => {
    it('should remove a key with --force', async () => {
      const env = await createTestEnv();
      const { server } = env;

      server.addUser({
        id: 'user-123',
        name: 'admin',
        createdAt: Date.now(),
      });
      server.addUserKey({
        fingerprint: 'SHA256:abc123',
        userId: 'user-123',
        label: 'laptop',
        addedAt: Date.now(),
      });

      const pxFn = await env.start();

      try {
        const { waitForOutput, instance } = await pxFn([
          'users',
          'keys',
          'remove',
          'user-123',
          'SHA256:abc123',
          '--force',
        ]);

        const foundSuccess = await waitForOutput(
          /Key removed successfully/i,
          30
        );
        expect(foundSuccess).toBe(true);

        const calls = server.getLogs();
        const removeCall = calls.find((c) => c.method === 'removeUserKey');
        expect(removeCall).toBeDefined();
      } finally {
        await env.stopAndCleanup();
      }
    });
  });
});
