import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import type {
  ChildProcess,
  ExecSyncOptions,
  SpawnOptions,
} from 'child_process';
import process from 'process';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { waitUntilReady } from './helpers.js';
import type { MethodCall } from '../test/test-dev-server.js';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = path.resolve(__dirname, '../../../../');
export const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
export const nodeExecutable = process.execPath;

export interface PxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// IMPORTANT: serverProcess and serverPort are intentionally global to support a common CLI pattern:
// 1. Call server() once to start a server and get a cleanup function
// 2. Call px() multiple times with different commands that talk to the same server
// 3. Call cleanup() at the end to shut down the server
// So you can call server multiple times in a test and each time it will use the same server, but you can call it safely to get tempDir or serverPort or whatever else you need.
// This mirrors real CLI usage where commands need a running server to operate against.
let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let tempDir: string | null = null;

export async function server({
  args = [],
  options = {},
}: {
  args?: string[];
  options?: SpawnOptions;
} = {}): Promise<{
  tempDir: string;
  serverPort: number;
  cleanup: () => Promise<void>;
}> {
  const cleanup = async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        serverProcess!.on('close', () => resolve());
      });
      serverProcess = null; // Reset the global serverProcess
      serverPort = null; // Reset the global serverPort
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null; // Reset the global tempDir
    }
  };

  try {
    if (!tempDir) {
      tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'positronic-server-test-')
      );
    }

    if (!serverProcess && !serverPort) {
      createMinimalProject(tempDir);

      const testPort = 9000 + Math.floor(Math.random() * 1000);

      // Default spawn options
      const defaultOptions: SpawnOptions = {
        cwd: tempDir,
        env: {
          ...process.env,
          POSITRONIC_TEST_MODE: 'true',
          POSITRONIC_SERVER_PORT: testPort.toString(),
        },
        stdio: 'pipe',
      };

      const finalOptions = {
        ...defaultOptions,
        ...options,
      };

      // Start the server
      serverProcess = spawn(
        nodeExecutable,
        [cliExecutable, 'server', '--port', testPort.toString(), ...args],
        finalOptions
      );

      const isReady = await waitUntilReady(testPort);

      if (!isReady) {
        throw new Error(`Server failed to start on port ${testPort}`);
      }

      serverPort = testPort;
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    tempDir,
    serverPort: serverPort!,
    cleanup,
  };
}

export async function px(
  command: string,
  options: Partial<ExecSyncOptions> = {}
): Promise<PxResult> {
  let tempDir: string | null = null;
  let serverPort: number | null = null;
  if (!command.startsWith('server')) {
    const result = await server();
    tempDir = result.tempDir;
    serverPort = result.serverPort;
  }

  // Default options for execSync
  const defaultSyncOptions: ExecSyncOptions = {
    cwd:
      tempDir ||
      fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-server-test-')),
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      ...process.env,
      POSITRONIC_TEST_MODE: 'true',
      ...(serverPort ? { POSITRONIC_SERVER_PORT: serverPort.toString() } : {}),
    },
  };

  const finalSyncOptions = {
    ...defaultSyncOptions,
    ...options,
  };

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    const result = execSync(
      `${nodeExecutable} ${cliExecutable} ${command}`,
      finalSyncOptions
    );
    stdout = result.toString() || '';
  } catch (error: any) {
    stdout = error.stdout;
    exitCode = error.status;
    stderr = error.stderr;
  }

  // Return result with cleanup function for successful cases
  return {
    stdout,
    stderr,
    exitCode,
  };
}

// Helper function to create a minimal Positronic project structure
export function createMinimalProject(dir: string, config?: any) {
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

  // Create default resources
  fs.writeFileSync(
    path.join(dir, 'resources', 'test.txt'),
    'Default test resource'
  );
  fs.writeFileSync(
    path.join(dir, 'resources', 'data.json'),
    '{"default": true}'
  );
}

// Helper function to fetch method call logs
export async function fetchLogs(port: number): Promise<MethodCall[]> {
  const response = await fetch(`http://localhost:${port}/test/logs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status}`);
  }
  return (await response.json()) as MethodCall[];
}

// Helper function to wait for types file to contain specific content
export async function waitForTypesFile(
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

// Helper function to wait for file changes to be detected
export async function waitForFileChange(
  checkFn: () => boolean | Promise<boolean>,
  maxWaitMs = 5000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await checkFn();
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}
