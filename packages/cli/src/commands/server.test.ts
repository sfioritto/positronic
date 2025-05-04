import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn, type ChildProcess } from 'child_process';
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
    const intervalMs = 1000;
    let serverReady = false;
    for (let i = 0; i < attempts; i++) {
        try {
            await fetch(url);
            serverReady = true;
            break;
        } catch (error) {
            // Ignore network errors
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return serverReady;
}

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
                POSITRONIC_LOCAL_PATH: workspaceRoot
            }
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
                POSITRONIC_LOCAL_PATH: workspaceRoot
            }
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

        serverProcess = spawn(nodeExecutable, [
            cliExecutable,
            'server',
            '--port',
            testPort.toString()
        ], {
            cwd: projectPath,
            stdio: 'inherit',
            detached: false,
            shell: true,
            env: {
                ...process.env,
                POSITRONIC_LOCAL_PATH: workspaceRoot
            }
        });

        const pid = serverProcess.pid;
        if (!pid) {
            throw new Error('Server process PID is undefined');
        }
        // 5. Verify that the server started
        const ready = await waitForServerReady(serverUrl);
        expect(ready).toBe(true);

        // Next step: Verify .positronic folder regeneration
    });
});
