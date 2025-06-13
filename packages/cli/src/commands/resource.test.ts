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
} from '@jest/globals';
import { fileURLToPath } from 'url';
import {
  getRandomPort,
  waitForProcessToExit,
  waitForServerReady,
} from '../../../../test-utils.js';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

// Increase test timeout - server tests need more time
jest.setTimeout(20000);

describe('CLI Integration: positronic resource types', () => {
  let tempDir: string;
  const projectName = 'test-resource-types';
  let serverProcess: ChildProcess | null = null;
  let testPort: number;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'positronic-resource-test-')
    );
    testPort = getRandomPort();
  });

  afterEach(async () => {
    if (serverProcess && serverProcess.pid) {
      serverProcess.kill('SIGTERM');
      await waitForProcessToExit(serverProcess.pid);
      serverProcess = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('should generate type definitions for resources', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);
    expect(fs.existsSync(projectPath)).toBe(true);

    // 2. Start the server
    const serverUrl = `http://localhost:${testPort}`;
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
        },
      }
    );

    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // 3. Create resources directory and some test files
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(path.join(resourcesDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(resourcesDir, 'data'), { recursive: true });

    // Create test files
    fs.writeFileSync(path.join(resourcesDir, 'example.md'), '# Example');
    fs.writeFileSync(path.join(resourcesDir, 'test.txt'), 'Test content');
    fs.writeFileSync(path.join(resourcesDir, 'docs', 'readme.md'), '# Readme');
    fs.writeFileSync(path.join(resourcesDir, 'data', 'config.json'), '{}');
    // PNG magic bytes
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    fs.writeFileSync(path.join(resourcesDir, 'data', 'logo.png'), pngHeader);

    // File with spaces (should be excluded from dot notation)
    fs.writeFileSync(
      path.join(resourcesDir, 'file with spaces.txt'),
      'content'
    );

    // 4. Sync resources to the server
    execSync(`${nodeExecutable} ${cliExecutable} resource sync`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 5. Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resource types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 4. Check if the types file was generated
    const typesPath = path.join(projectPath, 'resources.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    // 5. Read and verify the generated content
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Check the module declaration
    expect(content).toContain("declare module '@positronic/core'");

    // Check interface definitions
    expect(content).toContain('interface TextResource');
    expect(content).toContain('interface BinaryResource');
    expect(content).toContain('interface Resources');

    // Check method signatures
    expect(content).toContain('loadText(path: string): Promise<string>');
    expect(content).toContain('loadBinary(path: string): Promise<Buffer>');

    // Check generated resource properties
    expect(content).toContain('example: TextResource;');
    expect(content).toContain('test: TextResource;');
    expect(content).toContain('docs: {');
    expect(content).toContain('readme: TextResource;');
    expect(content).toContain('data: {');
    expect(content).toContain('config: TextResource;');
    expect(content).toContain('logo: BinaryResource;');

    // Should NOT contain files with invalid JS identifiers
    expect(content).not.toContain('file with spaces');

    // Check export statement
    expect(content).toContain('export {};');
  });

  it('should handle empty resources directory', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);

    // 2. Start the server
    const serverUrl = `http://localhost:${testPort}`;
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
        },
      }
    );

    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // 3. Create empty resources directory (might not exist by default)
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // 4. Run the types command (no sync needed since no resources)
    execSync(`${nodeExecutable} ${cliExecutable} resource types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 4. Check if the types file was generated
    const typesPath = path.join(projectPath, 'resources.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    // 5. Read and verify the generated content
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Should still have the basic structure
    expect(content).toContain("declare module '@positronic/core'");
    expect(content).toContain('interface Resources');
    expect(content).toContain('loadText(path: string): Promise<string>');
    expect(content).toContain('loadBinary(path: string): Promise<Buffer>');
  });

  it('should handle resources with special characters', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);

    // 2. Start the server
    const serverUrl = `http://localhost:${testPort}`;
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
        },
      }
    );

    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // 3. Create resources
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

    // 4. Sync resources to the server
    execSync(`${nodeExecutable} ${cliExecutable} resource sync`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 5. Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resource types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 4. Verify the generated content
    const typesPath = path.join(projectPath, 'resources.d.ts');
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
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);

    // 2. Start the server
    const serverUrl = `http://localhost:${testPort}`;
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
        },
      }
    );

    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // 3. Create resources
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

    // 4. Sync resources to the server
    execSync(`${nodeExecutable} ${cliExecutable} resource sync`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 5. Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resource types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    // 4. Verify the generated content
    const typesPath = path.join(projectPath, 'resources.d.ts');
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
