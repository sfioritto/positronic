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
} from '../../../../test-utils.js'; // Import helpers

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

// Increase test timeout
jest.setTimeout(15000); // Increased timeout for server startup

describe('CLI Integration: positronic server (Regeneration)', () => {
  let tempDir: string;
  const projectName = 'test-server-regen';
  let serverProcess: ChildProcess | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-server-test-'));
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

  it('should generate a new project with a .positronic directory', () => {
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

    // 2. Verify .positronic folder exists
    const positronicDir = path.join(projectPath, '.positronic');
    expect(fs.existsSync(positronicDir)).toBe(true);

    // 3. Remove the .positronic folder
    fs.rmSync(positronicDir, { recursive: true, force: true });
    expect(fs.existsSync(positronicDir)).toBe(false); // Verify it's removed

    // Teardown (directory removal) is handled by afterEach
  });

  it('should regenerate .positronic folder if missing and start server', async () => {
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

    // 2. Verify .positronic folder exists
    const positronicDir = path.join(projectPath, '.positronic');
    expect(fs.existsSync(positronicDir)).toBe(true);

    // 3. Remove the .positronic folder
    fs.rmSync(positronicDir, { recursive: true, force: true });
    expect(fs.existsSync(positronicDir)).toBe(false); // Verify it's removed

    // 4. Run the server
    const testPort = getRandomPort();
    const serverUrl = `http://localhost:${testPort}`;

    serverProcess = spawn(
      nodeExecutable,
      [cliExecutable, 'server', '--port', testPort.toString()],
      {
        cwd: projectPath,
        stdio: 'inherit',
        detached: false,
        shell: true,
        env: {
          ...process.env,
          POSITRONIC_LOCAL_PATH: workspaceRoot,
        },
      }
    );

    const pid = serverProcess.pid;
    if (!pid) {
      throw new Error('Server process PID is undefined');
    }
    // 5. Verify that the server started
    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // Next step: Verify .positronic folder regeneration
  });

  it('should force regenerate .positronic folder and start server', async () => {
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

    // 2. Verify .positronic folder exists initially
    const positronicDir = path.join(projectPath, '.positronic');
    expect(fs.existsSync(positronicDir)).toBe(true);

    // 3. Run the server with --force
    const testPort = getRandomPort();
    const serverUrl = `http://localhost:${testPort}`;

    serverProcess = spawn(
      nodeExecutable,
      [
        cliExecutable,
        'server',
        '--port',
        testPort.toString(),
        '--force', // Add the force flag
      ],
      {
        cwd: projectPath,
        stdio: 'ignore', // Keep stdio ignored for this test
        detached: false,
        shell: true,
        env: {
          ...process.env,
          POSITRONIC_LOCAL_PATH: workspaceRoot,
        },
      }
    );

    const pid = serverProcess.pid;
    if (!pid) {
      throw new Error('Server process PID is undefined');
    }

    // 4. Verify that the server started
    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    // 5. Verify .positronic folder still exists (was regenerated)
    expect(fs.existsSync(positronicDir)).toBe(true);
  });
});
