import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import process from 'process';
import fetch from 'node-fetch';


// Resolve paths relative to the workspace root
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
            stdio: 'inherit',
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
            stdio: 'inherit',
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

/* --- Commented out original test suite ---
// --- Cache Configuration ---
// const cacheDirParent = path.join(workspaceRoot, 'packages/cli/.test-cache');
// const cacheDirModules = path.join(cacheDirParent, 'server-node_modules');

// --- Test Suite ---
describe('CLI Integration: positronic new', () => {
    let tempDir: string;
    let projectName: string;
    let projectPath: string;
    let serverProcess: ChildProcess | null = null;
    let serverPid: number | undefined = undefined; // Store PID separately

    // Helper function to poll the server
    const checkServerReady = (url: string, timeout = 60000): Promise<void> => {
        const startTime = Date.now();
        return new Promise((resolve, reject) => {
            const attemptConnect = () => {
                http.get(url, (res) => {
                    // Any response means the server is up
                    res.resume(); // Consume response data
                    resolve();
                }).on('error', (err) => {
                    if (Date.now() - startTime > timeout) {
                        reject(new Error(`Server did not become ready at ${url} within ${timeout / 1000}s. Last error: ${err.message}`));
                    } else {
                        // Wait a bit before retrying
                        setTimeout(attemptConnect, 500);
                    }
                });
            };
            attemptConnect();
        });
    };

    // Helper to poll for directory existence
    const checkDirExists = (dirPath: string, timeout = 60000): Promise<void> => {
        const startTime = Date.now();
        return new Promise((resolve, reject) => {
            const attemptCheck = () => {
                if (fs.existsSync(dirPath)) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`Directory ${dirPath} did not appear within ${timeout / 1000}s.`));
                } else {
                    setTimeout(attemptCheck, 500);
                }
            };
            attemptCheck();
        });
    };

    // --- Cache Setup ---
    beforeAll(async () => {
        if (!fs.existsSync(cacheDirModules)) {
            let setupTempDir = '';
            let setupServerProcess: ChildProcess | null = null;
            try {
                // 1. Create temporary setup directory
                setupTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-cache-setup-'));
                const setupProjectName = 'cache-setup-proj';
                const setupProjectPath = path.join(setupTempDir, setupProjectName);
                const setupServerDir = path.join(setupProjectPath, '.positronic');
                const setupNodeModules = path.join(setupServerDir, 'node_modules');

                // 2. Create the new project structure
                execSync(`${nodeExecutable} ${cliExecutable} new ${setupProjectName}`, {
                    cwd: setupTempDir,
                    stdio: 'pipe',
                    env: {
                        ...process.env,
                        POSITRONIC_PACKAGES_DEV_PATH: workspaceRoot,
                        POSITRONIC_TEST_SKIP_SERVER_INSTALL: 'true'
                    }
                });
                // 3. Start the server with --force to install dependencies
                setupServerProcess = spawn(nodeExecutable, [cliExecutable, 'server', '--force'], {
                    cwd: setupProjectPath,
                    stdio: 'inherit',
                    detached: false,
                    env: {
                        ...process.env,
                        POSITRONIC_PACKAGES_DEV_PATH: workspaceRoot // Still need this for local linking
                    }
                });
                // 4. Wait for node_modules to appear
                 await checkDirExists(setupNodeModules, 150000);

                 // 5. Kill the setup server process forcefully
                 if (setupServerProcess && setupServerProcess.pid && !setupServerProcess.killed) {
                     setupServerProcess.kill('SIGKILL');
                     await new Promise(resolve => setTimeout(resolve, 500));
                 }

                 // 6. Create cache parent directory and copy node_modules
                 fs.mkdirSync(cacheDirParent, { recursive: true });
                 execSync(`cp -R "${setupNodeModules}" "${cacheDirModules}"`, { stdio: 'pipe' });

            } catch (error) {
                 // Ensure setup server is killed even on error
                 if (setupServerProcess && setupServerProcess.pid && !setupServerProcess.killed) {
                     console.error(` -> Killing setup server process (PID: ${setupServerProcess.pid}) due to error...`);
                     setupServerProcess.kill('SIGKILL');
                 }
                throw new Error(`Failed to populate test cache: ${error}`);
            } finally {
                // 7. Clean up setup directory
                if (setupTempDir && fs.existsSync(setupTempDir)) {
                    fs.rmSync(setupTempDir, { recursive: true, force: true });
                }
            }
        }
    });

    beforeEach(() => {
        // Create a unique temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-new-test-'));
        projectName = 'test-app';
        projectPath = path.join(tempDir, projectName);
        serverProcess = null; // Reset state variables
        serverPid = undefined;
    });

    afterEach(async () => {
        const pidToStop = serverPid; // Use the stored PID
        // Ensure the server process is stopped
        if (serverProcess && !serverProcess.killed) {
            const killed = serverProcess.kill('SIGTERM');
            if (!killed && pidToStop) {
                console.warn(`[Cleanup] SIGTERM failed for PID ${pidToStop}, trying SIGKILL...`);
                process.kill(pidToStop, 'SIGKILL');
            }
            // Wait briefly for potential process termination
            await new Promise(resolve => setTimeout(resolve, 500)); // Increased delay slightly for demo
            serverProcess = null;
            serverPid = undefined;
        }

        // Remove the temporary directory
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
        expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('should create a new project, copy cached modules, start server, and run workflow', async () => {
        // 1. Run `positronic new`
        execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
            cwd: tempDir,
            stdio: 'pipe',
            env: {
                ...process.env,
                POSITRONIC_TEST_SKIP_SERVER_INSTALL: 'true'
            }
        });

        // Basic verification
        expect(fs.existsSync(projectPath)).toBe(true);
        const serverDir = path.join(projectPath, '.positronic');
        const serverSrcDir = path.join(serverDir, 'src'); // Define src dir path
        const targetNodeModules = path.join(serverDir, 'node_modules');

        // 2. Setup .positronic dir: Create structure, copy config, copy cached modules
        fs.mkdirSync(serverSrcDir, { recursive: true });

        // Process and write config templates
        const templateDir = path.join(workspaceRoot, 'packages/cli/templates/cloudflare-dev-server');
        const processAndWriteTemplate = (tplFile: string, outFile: string) => {
            const tplPath = path.join(templateDir, tplFile);
            const outPath = path.join(serverDir, outFile);
            let content = fs.readFileSync(tplPath, 'utf-8');
            content = content.replace(/{{projectName}}/g, projectName);
            fs.writeFileSync(outPath, content);
        }
        const processAndWriteTemplateToSrc = (tplFile: string, outFile: string) => {
            const tplPath = path.join(templateDir, 'src', tplFile);
            const outPath = path.join(serverSrcDir, outFile);
            let content = fs.readFileSync(tplPath, 'utf-8');
            content = content.replace(/{{projectName}}/g, projectName);
            fs.writeFileSync(outPath, content);
        }
        processAndWriteTemplate('wrangler.jsonc.tpl', 'wrangler.jsonc');
        processAndWriteTemplate('tsconfig.json.tpl', 'tsconfig.json');
        processAndWriteTemplateToSrc('index.ts.tpl', 'index.ts');

        // Copy cached modules
        execSync(`cp -R "${cacheDirModules}" "${targetNodeModules}"`, { stdio: 'pipe' });

        // 3. Start `positronic server` (using cached modules)
        serverProcess = spawn(nodeExecutable, [cliExecutable, 'server'], { // No --force needed now
            cwd: projectPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            env: {
                ...process.env,
                 POSITRONIC_PACKAGES_DEV_PATH: workspaceRoot,
                 POSITRONIC_TEST_SKIP_SERVER_INSTALL: 'true' // <-- Set the skip flag
            }
        });
        serverPid = serverProcess.pid;

        serverProcess.stderr?.on('data', (data) => {
            // Keep critical server errors visible
            console.error(`[Server STDERR]: ${data.toString().trim()}`);
        });
        serverProcess.on('error', (err) => {
            // Simplified error for spawn failure
            console.error(`[Server Spawn ERROR]: ${err.message}`);
             if (serverProcess && !serverProcess.killed) serverProcess.kill();
             throw new Error(`Failed to spawn server process: ${err.message}`);
        });

        // 4. Wait for the server to be ready
        const serverUrl = 'http://localhost:8787';
        await checkServerReady(serverUrl);

        // 5. Run `positronic run example` - assuming 'example' is now a brain
        // Let execSync throw if the command fails (non-zero exit code)
        const runOutput = execSync(`${nodeExecutable} ${cliExecutable} run example`, {
             cwd: projectPath,
             encoding: 'utf8',
             stdio: 'pipe', // Capture stdout/stderr
             env: { ...process.env }
         });

        // 6. Validate run ID from output
        const runIdMatch = runOutput.match(/Run ID: ([\w-]+)/);
        expect(runIdMatch).toBeTruthy(); // Ensure the Run ID line exists
        const brainRunId = runIdMatch ? runIdMatch[1] : null;
        expect(brainRunId).not.toBeNull(); // Ensure we extracted an ID

        // 7. Verify the run exists via the history API endpoint
        const historyUrl = `${serverUrl}/brains/example/history?limit=25`; // Check recent history
        // Let fetch/expect throw if the API call or assertion fails
        const response = await fetch(historyUrl);
        expect(response.ok).toBe(true); // Check if API request was successful
        const historyData = await response.json() as { runs: Array<{ workflowRunId: string; [key: string]: any }> }; // Assume runs have an 'workflowRunId'
        // Check if the specific runId is present in the history using the correct field name
        const runExistsInHistory = historyData.runs.some(run => run.workflowRunId === brainRunId); // Use workflowRunId here
        expect(runExistsInHistory).toBe(true);
    });
});
*/