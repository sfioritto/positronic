import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
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

// Type alias for the expected history response structure
type HistoryResponse = {
  runs: any[]; // Assuming runs is an array of any type for simplicity
};

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

// Increase test timeout to 10 seconds because these tests are slow by their nature
jest.setTimeout(10000);

describe('CLI Integration: positronic new (Simplified)', () => {
  let tempDir: string;
  const projectName = 'test-app-simple';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-simple-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('should create new project, start server, run a workflow and kill server', async () => {
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

    const testPort = getRandomPort();
    const serverUrl = `http://localhost:${testPort}`;

    const serverProcess = spawn(
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

    const pid = serverProcess.pid;
    if (!pid) {
      throw new Error('Server process PID is undefined');
    }

    const ready = await waitForServerReady(serverUrl);
    expect(ready).toBe(true);

    execSync(`${nodeExecutable} ${cliExecutable} run example`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
        POSITRONIC_SERVER_PORT: testPort.toString(),
      },
    });

    const response = await fetch(
      `${serverUrl}/brains/example/history?limit=25`
    );
    expect(response.ok).toBe(true);
    const historyData = (await response.json()) as HistoryResponse;
    expect(historyData.runs.length).toBe(1);

    serverProcess.kill('SIGTERM');
    const exited = await waitForProcessToExit(pid);
    expect(exited).toBe(true);
  });
});
