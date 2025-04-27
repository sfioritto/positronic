import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn, ChildProcess } from 'child_process';
import http from 'http';

// Increase timeout for integration tests involving server startup and installs
jest.setTimeout(90000); // 90 seconds

// --- Configuration ---
// Resolve paths relative to the workspace root (assuming test runs from workspace root)
const workspaceRoot = path.resolve(__dirname, '../../../../'); // Adjust based on actual test execution context if needed
// Correct path to the compiled CLI entry point based on build output and package.json bin entry
const cliExecutable = path.join(workspaceRoot, 'packages/cli/dist/src/positronic.js');
const nodeExecutable = process.execPath; // Use the same node executing the test

// --- Cache Configuration ---
const cacheDirParent = path.join(workspaceRoot, 'packages/cli/.test-cache');
const cacheDirModules = path.join(cacheDirParent, 'server-node_modules');

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
                process.kill(pidToStop, 'SIGKILL');
            }
            // Wait briefly for potential process termination
            await new Promise(resolve => setTimeout(resolve, 100)); // Shortened delay
            serverProcess = null;
            serverPid = undefined;
        }
        // Removed logging for already stopped/not started cases

        // Remove the temporary directory
        if (fs.existsSync(tempDir)) {
             try {
                if (process.platform === "win32" && fs.existsSync(projectPath)) {
                     execSync(`attrib -R "${projectPath}\\*.*" /S /D`, { stdio: 'ignore' });
                }
                fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
             } catch (err: any) {
                // Log only the error during cleanup
                console.error(`[Cleanup] Error removing temporary directory ${tempDir}: ${err.message}`);
             }
        }
        // Removed final cleanup log
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
        const runOutput = execSync(`${nodeExecutable} ${cliExecutable} run example`, {
             cwd: projectPath,
             encoding: 'utf8',
             stdio: 'pipe',
             env: { ...process.env }
         });

        // 5. Validate brain run output
        expect(runOutput).toContain('Attempting to run brain: example...'); // Changed from workflow
        expect(runOutput).toContain('Brain run started successfully.'); // Changed from workflow
        expect(runOutput).toMatch(/Run ID: [\w-]+/);
    });
});