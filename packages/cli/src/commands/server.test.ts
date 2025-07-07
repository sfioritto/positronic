import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, jest } from '@jest/globals';
import {
  createTestEnv,
  waitForTypesFile,
  px,
  type TestEnv,
} from './test-utils.js';

describe('CLI Integration: positronic server', () => {
  let exitSpy: any;
  let env: TestEnv;
  beforeEach(async () => {
    // Stub process.exit so cleanup doesn't terminate Jest
    env = await createTestEnv();
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(async () => {
    env.cleanup();
    exitSpy.mockRestore();
  });

  describe('Project validation', () => {
    it('should not have server command available outside a Positronic project', async () => {
      // No server needed for this test - testing behavior without a project
      try {
        await px(['server']);
        // If we get here, the command didn't fail as expected
        expect(false).toBe(true); // Force failure
      } catch (error: any) {
        // Check that the error message indicates unknown command
        expect(error.message).toContain('Unknown command: server');
      }
    });
  });

  describe('Server lifecycle', () => {
    it('should call setup() and start() methods on the dev server', async () => {
      const { server } = env;
      await px(['server'], { server });

      try {
        const methodCalls = server.getLogs();
        // Verify the method calls
        const setupCall = methodCalls.find((call) => call.method === 'setup');
        const startCall = methodCalls.find((call) => call.method === 'start');

        expect(setupCall).toBeDefined();
        expect(setupCall!.args[0]).toBe(false); // force flag not set

        expect(startCall).toBeDefined();
      } finally {
        process.emit('SIGINT');
        await new Promise((r) => setImmediate(r));
      }
    });
  });

  describe('Initial sync tests', () => {
    it('should sync resources after server starts', async () => {
      const { server } = env;
      // Start the CLI's server command which will sync resources
      await px(['server'], { server });

      try {
        // Verify that the CLI attempted to upload both default resources
        const uploads = server
          .getLogs()
          .filter((c) => c.method === 'upload')
          .map((c) => (typeof c.args[0] === 'string' ? c.args[0] : ''));

        expect(uploads.length).toBe(9);
        // The multipart body should include the key/path for each resource
        expect(uploads.some((b) => b.includes('config.json'))).toBe(true);
        expect(uploads.some((b) => b.includes('data/config.json'))).toBe(true);
        expect(uploads.some((b) => b.includes('data/logo.png'))).toBe(true);
        expect(uploads.some((b) => b.includes('docs/api.md'))).toBe(true);
        expect(uploads.some((b) => b.includes('docs/readme.md'))).toBe(true);
        expect(uploads.some((b) => b.includes('example.md'))).toBe(true);
        expect(uploads.some((b) => b.includes('file with spaces.txt'))).toBe(
          true
        );
        expect(uploads.some((b) => b.includes('readme.md'))).toBe(true);
        expect(uploads.some((b) => b.includes('test.txt'))).toBe(true);
      } finally {
        process.emit('SIGINT');
        await new Promise((r) => setImmediate(r));
      }
    });

    it('should generate types file after server starts', async () => {
      // Stub process.exit so cleanup doesn't terminate Jest
      const { server } = env;
      await px(['server'], { server });

      try {
        // Wait for types file to be generated with our resources
        const typesPath = path.join(server.projectRootDir, 'resources.d.ts');
        const typesContent = await waitForTypesFile(typesPath, [
          'readme: TextResource;',
          'config: TextResource;',
          'api: TextResource;',
        ]);
        // Check that the types file was generated with content
        expect(typesContent).not.toBe('');
        // Check for the module declaration
        expect(typesContent).toContain("declare module '@positronic/core'");
        // Check for resource type definitions
        expect(typesContent).toContain('interface TextResource');
        expect(typesContent).toContain('interface BinaryResource');
        expect(typesContent).toContain('interface Resources');
        // Check for the specific resources we created
        expect(typesContent).toContain('readme: TextResource;');
        expect(typesContent).toContain('config: TextResource;');
        expect(typesContent).toContain('docs: {');
        expect(typesContent).toContain('api: TextResource;');
      } finally {
        // Trigger the cleanup path in ServerCommand to close file watchers
        process.emit('SIGINT');
        await new Promise((r) => setImmediate(r));
      }
    });
  });
});
