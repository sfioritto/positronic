import * as fs from 'fs';
import * as path from 'path';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  createTestServer,
  waitForTypesFile,
  testCliCommand,
} from './test-utils.js';

describe('CLI Integration: positronic server', () => {
  // describe('Project validation', () => {
  //   it('should not have server command available outside a Positronic project', async () => {
  //     // No server needed for this test - testing behavior without a project
  //     try {
  //       await testCliCommand(['server'], {
  //         projectRootPath: null, // No project root
  //       });
  //       // If we get here, the command didn't fail as expected
  //       expect(false).toBe(true); // Force failure
  //     } catch (error: any) {
  //       // Check that the error message indicates unknown command
  //       expect(error.message).toContain('Unknown command: server');
  //     }
  //   });
  // });

  // describe('Server lifecycle', () => {
  //   let server: TestServer;

  //   beforeEach(async () => {
  //     server = await createTestServer();
  //   });

  //   afterEach(async () => {
  //     await server.cleanup();
  //   });

  //   it('should call setup() and start() methods on the dev server', async () => {
  //     const methodCalls = server.handle.getLogs();

  //     // Verify the method calls
  //     const setupCall = methodCalls.find((call) => call.method === 'setup');
  //     const startCall = methodCalls.find((call) => call.method === 'start');

  //     expect(setupCall).toBeDefined();
  //     // Resolve symlinks before comparing paths
  //     expect(fs.realpathSync(setupCall!.args[0])).toBe(
  //       fs.realpathSync(server.dir)
  //     );
  //     expect(setupCall!.args[1]).toBe(undefined); // force flag not set

  //     expect(startCall).toBeDefined();
  //     expect(fs.realpathSync(startCall!.args[0])).toBe(
  //       fs.realpathSync(server.dir)
  //     );
  //   });
  // });

  describe('Initial sync tests', () => {
    it('should sync resources after server starts', async () => {
      // Stub process.exit so cleanup doesn't terminate Jest
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);

      const server = await createTestServer();

      try {
        // Start the CLI's server command which will sync resources
        await testCliCommand(['server'], { server });

        // Verify that the resources were synced and are available via the API
        const response = await fetch(
          `http://localhost:${server.port}/resources`
        );
        const data = (await response.json()) as {
          resources: Array<{ key: string }>;
          count: number;
        };

        expect(data).not.toBeNull();
        expect(data.resources).toBeDefined();
        expect(data.count).toBe(2); // 2 default resources from createMinimalProject

        const resourceKeys = data.resources.map((r) => r.key);
        expect(resourceKeys).toContain('test.txt');
        expect(resourceKeys).toContain('data.json');

        // Trigger the cleanup path in ServerCommand to close file watchers
        process.emit('SIGINT');
        await new Promise((r) => setImmediate(r));
      } finally {
        exitSpy.mockRestore();
        await server.stop();
      }
    });

    it('should generate types file after server starts', async () => {
      // Stub process.exit so cleanup doesn't terminate Jest
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);

      const server = await createTestServer({
        setup: (projectDir) => {
          // Create some resource files
          const resourcesDir = path.join(projectDir, 'resources');
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

          // Create data directory
          const dataDir = path.join(resourcesDir, 'data');
          fs.mkdirSync(dataDir, { recursive: true });

          // PNG magic bytes
          const pngHeader = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ]);
          fs.writeFileSync(path.join(dataDir, 'logo.png'), pngHeader);

          // File with spaces (should be excluded from dot notation)
          fs.writeFileSync(
            path.join(resourcesDir, 'file with spaces.txt'),
            'content'
          );
        },
      });

      try {
        await testCliCommand(['server'], { server });

        // Wait for types file to be generated with our resources
        const typesPath = path.join(server.projectRootDir, 'resources.d.ts');
        const typesContent = await waitForTypesFile(
          typesPath,
          [
            'readme: TextResource;',
            'config: TextResource;',
            'api: TextResource;',
          ],
          8000 // Increase timeout to 8 seconds
        );
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

        // Trigger the cleanup path in ServerCommand to close file watchers
        process.emit('SIGINT');
        await new Promise((r) => setImmediate(r));
      } finally {
        exitSpy.mockRestore();
        await server.stop();
      }
    });
  });
});
