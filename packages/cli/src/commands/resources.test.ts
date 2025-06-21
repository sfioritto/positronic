import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn, type ChildProcess } from 'child_process';
import process from 'process';
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from '@jest/globals';
import { fileURLToPath } from 'url';
import {
  getRandomPort,
  waitForProcessToExit,
  waitForServerReady,
} from '../../../../test-utils.js';
import { createTestServer, waitForTypesFile, cli } from './test-utils.js';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

// Increase test timeout
jest.setTimeout(30000);

describe('CLI Integration: positronic resources types', () => {
  let tempDir: string;
  const projectName = 'test-resource-types';
  let projectPath: string;
  let serverProcess: ChildProcess | null = null;
  let testPort: number;

  // Helper function to start the server
  async function startServer() {
    serverProcess = spawn(
      nodeExecutable,
      [cliExecutable, 'server', '--port', testPort.toString()],
      {
        cwd: projectPath,
        stdio: 'ignore',
        detached: false,
        env: {
          ...process.env,
          POSITRONIC_LOCAL_PATH: workspaceRoot,
          POSITRONIC_TEST_MODE: 'true',
        },
      }
    );

    const pid = serverProcess.pid;
    if (!pid) {
      throw new Error('Server process PID is undefined');
    }

    // Wait for server to be ready
    const serverUrl = `http://localhost:${testPort}`;
    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // Wait for server to complete initial sync and type generation
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'positronic-resource-test-')
    );
    testPort = getRandomPort();
    // Set the port in the current process environment so API client uses it
    process.env.POSITRONIC_SERVER_PORT = testPort.toString();

    // Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    projectPath = path.join(tempDir, projectName);
    expect(fs.existsSync(projectPath)).toBe(true);
  });

  afterEach(async () => {
    // Kill server if running
    if (serverProcess && serverProcess.pid) {
      serverProcess.kill('SIGTERM');
      await waitForProcessToExit(serverProcess.pid);
      serverProcess = null;
    }

    // Clean up environment variable
    delete process.env.POSITRONIC_SERVER_PORT;

    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('should generate type definitions for resources', async () => {
    const server = await createTestServer({
      setup: (dir: string) => {
        // Create resources directory and subdirectories
        const resourcesDir = path.join(dir, 'resources');
        fs.mkdirSync(resourcesDir, { recursive: true });
        fs.mkdirSync(path.join(resourcesDir, 'docs'), { recursive: true });
        fs.mkdirSync(path.join(resourcesDir, 'data'), { recursive: true });

        // Create test files
        fs.writeFileSync(path.join(resourcesDir, 'example.md'), '# Example');
        fs.writeFileSync(path.join(resourcesDir, 'test.txt'), 'Test content');
        fs.writeFileSync(
          path.join(resourcesDir, 'docs', 'readme.md'),
          '# Readme'
        );
        fs.writeFileSync(path.join(resourcesDir, 'data', 'config.json'), '{}');

        // PNG magic bytes
        const pngHeader = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        fs.writeFileSync(
          path.join(resourcesDir, 'data', 'logo.png'),
          pngHeader
        );

        // File with spaces (should be excluded from dot notation)
        fs.writeFileSync(
          path.join(resourcesDir, 'file with spaces.txt'),
          'content'
        );
      },
    });

    try {
      // Wait for types file to be generated with our resources
      const typesPath = path.join(server.dir, 'resources.d.ts');
      const typesContent = await waitForTypesFile(typesPath, [
        'example: TextResource;',
        'test: TextResource;',
        'docs: {',
        'readme: TextResource;',
        'data: {',
        'config: TextResource;',
        'logo: BinaryResource;',
      ]);

      // Check that the types file was generated
      expect(fs.existsSync(typesPath)).toBe(true);

      // Check the module declaration
      expect(typesContent).toContain("declare module '@positronic/core'");

      // Check interface definitions
      expect(typesContent).toContain('interface TextResource');
      expect(typesContent).toContain('interface BinaryResource');
      expect(typesContent).toContain('interface Resources');

      // Check method signatures
      expect(typesContent).toContain('loadText(path: string): Promise<string>');
      expect(typesContent).toContain(
        'loadBinary(path: string): Promise<Buffer>'
      );

      // Check generated resource properties
      expect(typesContent).toContain('example: TextResource;');
      expect(typesContent).toContain('test: TextResource;');
      expect(typesContent).toContain('docs: {');
      expect(typesContent).toContain('readme: TextResource;');
      expect(typesContent).toContain('data: {');
      expect(typesContent).toContain('config: TextResource;');
      expect(typesContent).toContain('logo: BinaryResource;');

      // Should NOT contain files with invalid JS identifiers
      expect(typesContent).not.toContain('file with spaces');

      // Check export statement
      expect(typesContent).toContain('export {};');
    } finally {
      await server.cleanup();
    }
  });

  it('should handle empty resources directory', async () => {
    const server = await createTestServer();

    try {
      // Remove the default resources created by createMinimalProject
      const resourcesDir = path.join(server.dir, 'resources');
      const defaultFiles = fs.readdirSync(resourcesDir);
      for (const file of defaultFiles) {
        fs.unlinkSync(path.join(resourcesDir, file));
      }

      // Verify directory is empty
      expect(fs.readdirSync(resourcesDir).length).toBe(0);

      // Run the types command using cli
      const px = cli(server);
      const result = await px('resources types');

      // Command should succeed
      expect(result.exitCode).toBe(0);

      // Check if the types file was generated
      const typesPath = path.join(server.dir, 'resources.d.ts');
      expect(fs.existsSync(typesPath)).toBe(true);

      // Read and verify the generated content
      const content = fs.readFileSync(typesPath, 'utf-8');

      // Should still have the basic structure
      expect(content).toContain("declare module '@positronic/core'");
      expect(content).toContain('interface Resources');
      expect(content).toContain('loadText(path: string): Promise<string>');
      expect(content).toContain('loadBinary(path: string): Promise<Buffer>');
    } finally {
      await server.cleanup();
    }
  });

  it('should handle resources with special characters', async () => {
    // Create resources
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // Create files with special characters
    fs.writeFileSync(path.join(resourcesDir, 'valid_file.txt'), 'content');
    fs.writeFileSync(path.join(resourcesDir, '$special.txt'), 'content'); // Valid JS identifier
    fs.writeFileSync(path.join(resourcesDir, '_underscore.txt'), 'content'); // Valid JS identifier
    fs.writeFileSync(path.join(resourcesDir, '123invalid.txt'), 'content'); // Invalid - starts with number
    fs.writeFileSync(
      path.join(resourcesDir, 'special-chars!@#.txt'),
      'content'
    ); // Invalid

    // Start the server
    await startServer();

    // Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resources types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // Check if the types file was generated
    const typesPath = path.join(projectPath, 'resources.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    // Verify the generated content
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Check valid identifiers are included
    expect(content).toContain('valid_file: TextResource;');
    expect(content).toContain('$special: TextResource;');
    expect(content).toContain('_underscore: TextResource;');

    // Check invalid identifiers are excluded
    expect(content).not.toContain('123invalid');
    expect(content).not.toContain('special-chars');
  });

  it('should correctly identify text vs binary files', async () => {
    // Create resources
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // Create various file types
    fs.writeFileSync(path.join(resourcesDir, 'text.txt'), 'text');
    fs.writeFileSync(path.join(resourcesDir, 'script.js'), 'code');
    fs.writeFileSync(path.join(resourcesDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(resourcesDir, 'styles.css'), 'css');

    // Create actual binary content for binary files
    // JPEG magic bytes
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    fs.writeFileSync(path.join(resourcesDir, 'image.jpg'), jpegHeader);

    // Random binary data
    const binaryData = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
    ]);
    fs.writeFileSync(path.join(resourcesDir, 'binary.bin'), binaryData);

    // PDF magic bytes
    const pdfHeader = Buffer.from('%PDF-1.4\n%âÌÊÓ\n');
    fs.writeFileSync(path.join(resourcesDir, 'document.pdf'), pdfHeader);

    // Start the server
    await startServer();

    // Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resources types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // Check if the types file was generated
    const typesPath = path.join(projectPath, 'resources.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    // Verify the generated content
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Check text resources
    expect(content).toContain('text: TextResource;');
    expect(content).toContain('script: TextResource;');
    expect(content).toContain('config: TextResource;');
    expect(content).toContain('styles: TextResource;');

    // Check binary resources
    expect(content).toContain('image: BinaryResource;');
    expect(content).toContain('binary: BinaryResource;');
    expect(content).toContain('document: BinaryResource;');
  });
});
