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
}

// Helper function results
interface PxResult {
  tempDir: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  cleanup?: () => Promise<void>; // optional cleanup handler when spawn is true
}

let serverProcess: ChildProcess | null = null;

async function px(
  command: string,
  options?: PxOptions,
  shouldSpawnServer: boolean = true
): Promise<PxResult> {
  // Create temp directory
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-server-test-')
  );

  let serverPort: number | null = null;
  let localServerProcess: ChildProcess | null = null;

  // Define cleanup function
  const cleanup = async () => {
    if (localServerProcess && !localServerProcess.killed) {
      localServerProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        localServerProcess!.on('close', () => resolve());
      });
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
      localServerProcess = serverProcess = spawn(
        nodeExecutable,
        [cliExecutable, 'server', '--port', testPort.toString()],
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

    const finalSyncOptions = { ...defaultSyncOptions, ...options?.syncOptions };

    // Execute the command
    const result = execSync(
      `${nodeExecutable} ${cliExecutable} ${command}`,
      finalSyncOptions
    );
    stdout = result?.toString() || '';
  } catch (error: any) {
    // If command execution fails, clean up everything
    await cleanup();
    throw error;
  }

  return {
    tempDir,
    stdout,
    stderr,
    exitCode,
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

// Helper function to wait for test server to be ready
async function waitUntilReady(
  port: number,
  maxWaitMs = 5000
): Promise<boolean> {
  const startTime = Date.now();

  // Give the server a moment to start listening
  await new Promise((resolve) => setTimeout(resolve, 1000));

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const url = `http://localhost:${port}/test/status`;
      const response = await fetch(url);
      if (response.ok) {
        const status = (await response.json()) as { ready: boolean };
        if (status.ready) {
          return true;
        }
      }
    } catch (e: any) {
      // Server not ready yet - connection refused is expected
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

// Helper function to fetch method call logs
async function fetchLogs(port: number): Promise<MethodCall[]> {
  const response = await fetch(`http://localhost:${port}/test/logs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status}`);
  }
  return (await response.json()) as MethodCall[];
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
      // Create a minimal project structure
      const projectDir = path.join(tempDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      // Create project structure
      createMinimalProject(projectDir);

      // Use a random port to avoid conflicts
      const testPort = 9000 + Math.floor(Math.random() * 1000);

      // Start the server
      const serverProcess = spawn(
        nodeExecutable,
        [cliExecutable, 'server', '--port', testPort.toString()],
        {
          cwd: projectDir,
          env: {
            ...process.env,
            POSITRONIC_TEST_MODE: 'true',
            POSITRONIC_SERVER_PORT: testPort.toString(),
          },
          stdio: 'pipe',
        }
      );

      // Wait for server to be ready
      const isReady = await waitUntilReady(testPort);
      expect(isReady).toBe(true);

      // Get the method call logs
      const methodCalls = await fetchLogs(testPort);

      // Clean up the server process
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => serverProcess.on('close', resolve));

      // Verify the method calls
      const setupCall = methodCalls.find((call) => call.method === 'setup');
      const startCall = methodCalls.find((call) => call.method === 'start');

      expect(setupCall).toBeDefined();
      // Resolve symlinks before comparing paths
      expect(fs.realpathSync(setupCall!.args[0])).toBe(
        fs.realpathSync(projectDir)
      );
      expect(setupCall!.args[1]).toBe(false); // force flag not set

      expect(startCall).toBeDefined();
      expect(fs.realpathSync(startCall!.args[0])).toBe(
        fs.realpathSync(projectDir)
      );
      expect(startCall!.args[1]).toBe(testPort);
    });
  });
});
