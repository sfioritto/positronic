import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import type {
  ChildProcess,
  ExecSyncOptions,
  SpawnOptions,
} from 'child_process';
import process from 'process';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fileURLToPath } from 'url';
import type { MethodCall } from '../test/test-dev-server.js';
import fetch from 'node-fetch';
import { waitUntilReady } from './helpers.js';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

// Helper function options
interface PxOptions {
  syncOptions?: Partial<ExecSyncOptions>;
  spawnOptions?: Partial<SpawnOptions>;
  serverOptions?: string[]; // Command-line options to pass to server (e.g., ['--force'])
}

// Helper function results
interface PxResult {
  tempDir: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  serverPort: number | null;
  cleanup: () => Promise<void>; // optional cleanup handler when spawn is true
}

// IMPORTANT: serverProcess is intentionally global to support a common CLI pattern:
// 1. Call px() once to start a server
// 2. Call px() multiple times with different commands that talk to the same server
// 3. Call cleanup() at the end to shut down the server
// This mirrors real CLI usage where commands need a running server to operate against.
let serverProcess: ChildProcess | null = null;

async function px(
  command?: string,
  options?: PxOptions,
  shouldSpawnServer: boolean = true
): Promise<PxResult> {
  // Create temp directory
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-server-test-')
  );

  let serverPort: number | null = null;

  // Define cleanup function
  const cleanup = async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        serverProcess!.on('close', () => resolve());
      });
      serverProcess = null; // Reset the global serverProcess
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    if (shouldSpawnServer && !serverProcess) {
      createMinimalProject(tempDir);

      // Use a random port to avoid conflicts
      const testPort = 9000 + Math.floor(Math.random() * 1000);

      // Default spawn options
      const defaultSpawnOptions: SpawnOptions = {
        cwd: tempDir,
        env: {
          ...process.env,
          POSITRONIC_TEST_MODE: 'true',
          POSITRONIC_SERVER_PORT: testPort.toString(),
        },
        stdio: 'pipe',
      };

      const finalSpawnOptions = {
        ...defaultSpawnOptions,
        ...options?.spawnOptions,
      };

      // Start the server
      serverProcess = spawn(
        nodeExecutable,
        [
          cliExecutable,
          'server',
          '--port',
          testPort.toString(),
          ...(options?.serverOptions || []),
        ],
        finalSpawnOptions
      );

      const isReady = await waitUntilReady(testPort);

      if (!isReady) {
        throw new Error(`Server failed to start on port ${testPort}`);
      }

      serverPort = testPort;
    }
  } catch (error) {
    // If server setup fails, clean up
    await cleanup();
    throw error;
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    // Default options for execSync
    const defaultSyncOptions: ExecSyncOptions = {
      cwd: tempDir,
      stdio: 'pipe',
      encoding: 'utf8',
      env: {
        ...process.env,
        POSITRONIC_TEST_MODE: 'true',
        ...(serverPort
          ? { POSITRONIC_SERVER_PORT: serverPort.toString() }
          : {}),
      },
    };

    if (command) {
      const finalSyncOptions = {
        ...defaultSyncOptions,
        ...options?.syncOptions,
      };
      const result = execSync(
        `${nodeExecutable} ${cliExecutable} ${command}`,
        finalSyncOptions
      );
      stdout = result?.toString() || '';
    }
  } catch (error: any) {
    // If command execution fails, clean up everything
    await cleanup();
    throw error;
  }

  // Return result with cleanup function for successful cases
  return {
    tempDir,
    stdout,
    stderr,
    exitCode,
    serverPort,
    cleanup,
  };
}

// Helper function to create a minimal Positronic project structure
function createMinimalProject(dir: string, config?: any) {
  const defaultConfig = {
    name: 'test-project',
    version: '1.0.0',
  };

  fs.writeFileSync(
    path.join(dir, 'positronic.config.json'),
    JSON.stringify({ ...defaultConfig, ...config }, null, 2)
  );

  fs.mkdirSync(path.join(dir, 'brains'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
}

// Helper function to fetch method call logs
async function fetchLogs(port: number): Promise<MethodCall[]> {
  const response = await fetch(`http://localhost:${port}/test/logs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status}`);
  }
  return (await response.json()) as MethodCall[];
}

// Helper function to wait for resources to sync
async function waitForResourcesSync(
  serverPort: number,
  expectedCount: number,
  maxWaitMs = 5000
): Promise<{ resources: Array<{ key: string }>; count: number } | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`http://localhost:${serverPort}/resources`);
    if (response.ok) {
      const data = (await response.json()) as {
        resources: Array<{ key: string }>;
        count: number;
      };
      if (data.count === expectedCount) {
        return data;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

// Helper function to wait for types file to contain specific content
async function waitForTypesFile(
  typesPath: string,
  expectedContent: string | string[],
  maxWaitMs = 5000
): Promise<string> {
  const startTime = Date.now();
  const contentToCheck = Array.isArray(expectedContent)
    ? expectedContent
    : [expectedContent];

  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(typesPath)) {
      const content = fs.readFileSync(typesPath, 'utf-8');
      // Check if all expected content is present
      if (contentToCheck.every((expected) => content.includes(expected))) {
        return content;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return '';
}

describe('CLI Integration: positronic server', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-server-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Project validation', () => {
    it('should not have server command available outside a Positronic project', async () => {
      // Run server command in a directory that is NOT a Positronic project
      try {
        await px('server', undefined, false);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        // The server command should not be recognized outside a project
        expect(error.stderr).toContain('Unknown command: server');
        expect(error.status).toBe(1);
      }

      // Additionally, if we check help, server command should not be listed
      const helpResult = await px('--help', undefined, false);

      expect(helpResult.stdout).not.toContain('server');
      expect(helpResult.stdout).not.toContain(
        'Start the local development server'
      );

      // Clean up
      await helpResult.cleanup?.();
    });
  });

  describe('Server lifecycle', () => {
    it('should call setup() and start() methods on the dev server', async () => {
      const { tempDir, cleanup, serverPort } = await px();

      if (!serverPort) {
        throw new Error('Server port is not set');
      }

      // Wait for server to be ready
      const isReady = await waitUntilReady(serverPort);
      expect(isReady).toBe(true);

      // Get the method call logs
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

      // Clean up the server process
      await cleanup();
    });

    it('should call setup() with force=true when --force flag is used', async () => {
      // Start server with --force flag
      const { cleanup, serverPort } = await px(undefined, {
        serverOptions: ['--force'],
      });

      if (!serverPort) {
        throw new Error('Server port is not set');
      }

      // Wait for server to be ready
      const isReady = await waitUntilReady(serverPort);
      expect(isReady).toBe(true);

      // Get the method call logs
      const methodCalls = await fetchLogs(serverPort);

      // Verify setup was called with force=true
      const setupCall = methodCalls.find((call) => call.method === 'setup');
      expect(setupCall).toBeDefined();
      expect(setupCall!.args[1]).toBe(true); // force flag should be true

      // Clean up
      await cleanup();
    });
  });

  describe('Initial sync tests', () => {
    it('should sync resources after server starts', async () => {
      const { tempDir, cleanup, serverPort } = await px();

      if (!serverPort) {
        throw new Error('Server port is not set');
      }

      // Create some resource files before server fully initializes
      const resourcesDir = path.join(tempDir, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });
      fs.writeFileSync(path.join(resourcesDir, 'test.txt'), 'Hello World');
      fs.writeFileSync(
        path.join(resourcesDir, 'data.json'),
        '{"key": "value"}'
      );

      // Wait for server to be ready
      const isReady = await waitUntilReady(serverPort);
      expect(isReady).toBe(true);

      // Wait for initial sync to complete
      const data = await waitForResourcesSync(serverPort, 2);

      // Now verify the results
      expect(data).not.toBeNull();
      expect(data!.resources).toBeDefined();
      expect(data!.count).toBe(2);

      // Verify the resources were loaded from filesystem
      const resourceKeys = data!.resources.map((r) => r.key);
      expect(resourceKeys).toContain('test.txt');
      expect(resourceKeys).toContain('data.json');

      // Clean up
      await cleanup();
    });

    it('should generate types file after server starts', async () => {
      const { tempDir, cleanup, serverPort } = await px();

      if (!serverPort) {
        throw new Error('Server port is not set');
      }

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

      // Wait for server to be ready
      const isReady = await waitUntilReady(serverPort);
      expect(isReady).toBe(true);

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

      // Clean up
      await cleanup();
    });
  });
});
