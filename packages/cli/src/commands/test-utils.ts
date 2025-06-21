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

export interface TestServer {
  port: number;
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestServer({
  args = [],
  spawnOptions = {},
}: {
  args?: string[];
  spawnOptions?: SpawnOptions;
} = {}): Promise<TestServer> {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'positronic-server-test-')
  );

  let serverProcess: ChildProcess | null = null;

  const cleanup = async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        serverProcess!.on('close', () => resolve());
      });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    createMinimalProject(tempDir);

    const port = 9000 + Math.floor(Math.random() * 1000);

    // Default spawn options
    const defaultOptions: SpawnOptions = {
      cwd: tempDir,
      env: {
        ...process.env,
        POSITRONIC_TEST_MODE: 'true',
        POSITRONIC_SERVER_PORT: port.toString(),
      },
      stdio: 'pipe',
    };

    const finalOptions = {
      ...defaultOptions,
      ...spawnOptions,
    };

    // Start the server
    serverProcess = spawn(
      nodeExecutable,
      [cliExecutable, 'server', '--port', port.toString(), ...args],
      finalOptions
    );

    const isReady = await waitUntilReady(port);

    if (!isReady) {
      throw new Error(`Server failed to start on port ${port}`);
    }

    return {
      port,
      dir: tempDir,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function cli(server?: TestServer) {
  return async (
    command: string,
    options: Partial<ExecSyncOptions> = {}
  ): Promise<PxResult> => {
    // Default options for execSync
    const defaultSyncOptions: ExecSyncOptions = {
      cwd: server?.dir || process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8',
      env: {
        ...process.env,
        POSITRONIC_TEST_MODE: 'true',
        ...(server ? { POSITRONIC_SERVER_PORT: server.port.toString() } : {}),
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
      stdout = error.stdout || '';
      stderr = error.stderr || '';
      exitCode = error.status || 1;
    }

    return {
      stdout,
      stderr,
      exitCode,
    };
  };
}

// Legacy functions for backward compatibility - mark as deprecated
/**
 * @deprecated Use createTestServer() instead
 */
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
  const testServer = await createTestServer({ args, spawnOptions: options });
  return {
    tempDir: testServer.dir,
    serverPort: testServer.port,
    cleanup: testServer.cleanup,
  };
}

/**
 * @deprecated Use cli() instead
 */
export async function px(
  command: string,
  options: Partial<ExecSyncOptions> = {}
): Promise<PxResult> {
  // For backward compatibility, px creates its own server if needed
  let server: TestServer | undefined = undefined;

  if (
    !command.startsWith('server') &&
    !command.startsWith('new') &&
    !command.includes('--help')
  ) {
    server = await createTestServer();
  }

  try {
    const px = cli(server);
    return await px(command, options);
  } finally {
    if (server) {
      await server.cleanup();
    }
  }
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

// No more resetTestGlobals - each test manages its own server
