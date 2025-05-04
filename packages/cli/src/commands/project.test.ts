import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import process from 'process';
import fetch from 'node-fetch';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { fileURLToPath } from 'url';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(workspaceRoot, 'packages/cli/dist/src/positronic.js');
const nodeExecutable = process.execPath;

// Simple random port generator (user port range)
function getRandomPort(): number {
    return Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;
}

async function waitForProcessToExit(pid: number): Promise<boolean> {
    const attempts = 4;
    const intervalMs = 50;
    let processExited = false;
    for (let i = 0; i < attempts; i++) {
        try {
            process.kill(pid, 0);
        } catch (error) {
            processExited = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return processExited;
}

async function waitForServerReady(url: string): Promise<boolean> {
    const attempts = 10;
    const intervalMs = 500;
    let serverReady = false;
    for (let i = 0; i < attempts; i++) {
        try {
            await fetch(url);
            // If fetch succeeds (doesn't throw), the server is listening
            serverReady = true;
            break;
        } catch (error) {
            // Ignore network errors (like ECONNREFUSED), server not ready
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return serverReady;
}

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
                POSITRONIC_PACKAGES_DEV_PATH: workspaceRoot
            }
        });

        const projectPath = path.join(tempDir, projectName);
        expect(fs.existsSync(projectPath)).toBe(true);

        const testPort = getRandomPort();
        const serverUrl = `http://localhost:${testPort}`;

        const serverProcess = spawn(nodeExecutable, [
            cliExecutable,
            'server',
            '--port',
            testPort.toString()
        ], {
            cwd: projectPath,
            stdio: 'ignore',
            detached: false,
            env: {
                ...process.env,
                POSITRONIC_PACKAGES_DEV_PATH: workspaceRoot
            }
        });

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
                POSITRONIC_PACKAGES_DEV_PATH: workspaceRoot,
                POSITRONIC_SERVER_PORT: testPort.toString()
            }
        });

        const response = await fetch(`${serverUrl}/brains/example/history?limit=25`);
        expect(response.ok).toBe(true);
        const historyData = await response.json();
        expect(historyData.runs.length).toBe(1);

        serverProcess.kill('SIGTERM');
        const exited = await waitForProcessToExit(pid);
        expect(exited).toBe(true);
    });
});