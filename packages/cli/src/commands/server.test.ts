import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, afterEach } from '@jest/globals';
import fetch from 'node-fetch';
import { server, px, fetchLogs, waitForTypesFile } from './test-utils.js';

describe('CLI Integration: positronic server', () => {
  describe('Project validation', () => {
    it('should not have server command available outside a Positronic project', async () => {
      // Run server command in a directory that is NOT a Positronic project
      const { stderr, exitCode } = await px('server');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command: server');

      // Additionally, if we check help, server command should not be listed
      const helpResult = await px('server --help');

      expect(helpResult.stdout).not.toContain('server');
      expect(helpResult.stdout).not.toContain(
        'Start the local development server'
      );
    });
  });

  describe('Server lifecycle', () => {
    it('should call setup() and start() methods on the dev server', async () => {
      // Call this to get the port and tempDir, server is already started
      // though in the beforeEach.
      const { serverPort, tempDir, cleanup } = await server();

      try {
        const methodCalls = await fetchLogs(serverPort);

        // Verify the method calls
        const setupCall = methodCalls.find((call) => call.method === 'setup');
        const startCall = methodCalls.find((call) => call.method === 'start');

        expect(setupCall).toBeDefined();
        // Resolve symlinks before comparing paths
        expect(fs.realpathSync(setupCall!.args[0])).toBe(
          fs.realpathSync(tempDir)
        );
        expect(setupCall!.args[1]).toBe(false); // force flag not set

        expect(startCall).toBeDefined();
        expect(fs.realpathSync(startCall!.args[0])).toBe(
          fs.realpathSync(tempDir)
        );
        expect(startCall!.args[1]).toBe(serverPort);
      } finally {
        await cleanup();
      }
    });
  });

  describe('Initial sync tests', () => {
    it('should sync resources after server starts', async () => {
      const { serverPort, cleanup } = await server();

      try {
        // Get resources that should have been synced from createMinimalProject
        const response = await fetch(
          `http://localhost:${serverPort}/resources`
        );
        const data = (await response.json()) as {
          resources: Array<{ key: string }>;
          count: number;
        };
        // Now verify the results
        expect(data).not.toBeNull();
        expect(data!.resources).toBeDefined();
        expect(data!.count).toBe(2); // 2 default resources from createMinimalProject
        // Verify the resources were loaded from filesystem
        const resourceKeys = data!.resources.map((r) => r.key);
        expect(resourceKeys).toContain('test.txt');
        expect(resourceKeys).toContain('data.json');
      } finally {
        await cleanup();
      }
    });
    it('should generate types file after server starts', async () => {
      const { tempDir, cleanup } = await server();

      try {
        // Create some resource files
        const resourcesDir = path.join(tempDir, 'resources');
        fs.mkdirSync(resourcesDir, { recursive: true });
        fs.writeFileSync(path.join(resourcesDir, 'readme.md'), '# README');
        fs.writeFileSync(
          path.join(resourcesDir, 'config.json'),
          '{"setting": true}'
        );
        // Create a subdirectory with a resource
        const docsDir = path.join(resourcesDir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, 'api.md'), '# API Documentation');
        // Wait for types file to be generated with our resources
        const typesPath = path.join(tempDir, 'resources.d.ts');
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
        await cleanup();
      }
    });
  });
});
