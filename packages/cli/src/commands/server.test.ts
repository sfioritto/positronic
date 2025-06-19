import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
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
    it('should not have server command available outside a Positronic project', () => {
      // Run server command in a directory that is NOT a Positronic project
      let stderr: string = '';
      let exitCode: number = 0;

      try {
        execSync(`${nodeExecutable} ${cliExecutable} server`, {
          cwd: tempDir, // Empty directory, no positronic.config.json
          stdio: 'pipe',
          encoding: 'utf8',
          env: {
            ...process.env,
            POSITRONIC_TEST_MODE: 'true',
          },
        });
      } catch (error: any) {
        stderr = error.stderr || '';
        exitCode = error.status || 1;
      }

      // The server command should not be recognized outside a project
      // Yargs will show an error about unknown command
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command: server');

      // Additionally, if we check help, server command should not be listed
      const helpOutput = execSync(`${nodeExecutable} ${cliExecutable} --help`, {
        cwd: tempDir,
        stdio: 'pipe',
        encoding: 'utf8',
        env: {
          ...process.env,
        },
      });

      expect(helpOutput).not.toContain('server');
      expect(helpOutput).not.toContain('Start the local development server');
    });
  });

  describe('Server lifecycle', () => {
    it('should call setup() and start() methods on the dev server', async () => {
      // Create a minimal project structure
      const projectDir = path.join(tempDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      // Create a minimal positronic.config.json
      const config = {
        name: 'test-project',
        version: '1.0.0',
      };
      fs.writeFileSync(
        path.join(projectDir, 'positronic.config.json'),
        JSON.stringify(config, null, 2)
      );

      // Create required directories
      fs.mkdirSync(path.join(projectDir, 'brains'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'resources'), { recursive: true });

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
