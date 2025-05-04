import * as path from 'path';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import caz from 'caz';
// @ts-ignore Could not find a declaration file for module '@positronic/template-new-project'.
import pkg from '@positronic/template-new-project';
const { generateManifest: regenerateManifestFile } = pkg;

/**
 * Sets up the .positronic server environment directory.
 * If the directory is missing or forceSetup is true, it generates the
 * full project in a temporary directory and copies the .positronic
 * part into the actual project.
 */
export async function setupPositronicServerEnv(
    projectRootPath: string,
    forceSetup: boolean = false
) {
    const serverDir = path.join(projectRootPath, '.positronic');
    const serverDirExists = await fsPromises.access(serverDir).then(() => true).catch(() => false);

    if (!serverDirExists || forceSetup) {
        console.log(forceSetup ? "Forcing regeneration of .positronic environment..." : "Missing .positronic environment, generating...");

        // --- Generate in Temp and Copy ---
        let tempDir: string | undefined;
        let newProjectTemplatePath = '@positronic/template-new-project';
        try {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-server-setup-'));
            const tempProjectName = 'temp-positronic-gen'; // Name used for temp generation

            const devPath = process.env.POSITRONIC_LOCAL_PATH;
            if (devPath) {
                const originalNewProjectPath = path.resolve(devPath, 'packages', 'template-new-project');
                // Copy template to avoid caz install issues in monorepo
                const tempTemplateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-template-copy-'));
                fs.cpSync(originalNewProjectPath, tempTemplateDir, { recursive: true });
                newProjectTemplatePath = tempTemplateDir;
            }

            // Hardcode options for non-interactive run, default to Cloudflare
            const cazOptions = {
                name: tempProjectName,
                backend: 'cloudflare',
                install: false, // Don't install deps in temp dir
                // pm doesn't matter if install is false
            };

            // Generate the full structure in the temporary directory
            await caz.default(newProjectTemplatePath, path.join(tempDir, tempProjectName), {
                ...cazOptions,
                force: true, // Force overwrite in the temp dir
            });

            const sourcePositronicDir = path.join(tempDir, tempProjectName, '.positronic');
            const targetPositronicDir = serverDir; // The actual .positronic in user's project

            // If forcing setup, remove existing target first
            if (serverDirExists && forceSetup) {
                await fsPromises.rm(targetPositronicDir, { recursive: true, force: true });
            }

            // Copy the generated .positronic directory
            await fsPromises.cp(sourcePositronicDir, targetPositronicDir, { recursive: true });

        } finally {
            // Clean up the temporary generation directory
            if (tempDir) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            // Clean up the temporary template copy if it was created
            if (newProjectTemplatePath.startsWith(os.tmpdir()) && newProjectTemplatePath !== '@positronic/template-new-project') {
                fs.rmSync(newProjectTemplatePath, { recursive: true, force: true });
            }
        }
        // --- End Generate in Temp and Copy ---
    }

    // Regenerate manifest based on actual project state AFTER setup/copy
    const srcDir = path.join(serverDir, 'src');
    await regenerateManifestFile(projectRootPath, srcDir);
}

// --- ServerCommand Class ---

export class ServerCommand {
    // Main handler logic from handleServer
    async handle(argv: ArgumentsCamelCase<any>, projectRootPath: string | null) {
        if (!projectRootPath) {
            console.error("Error: Not inside a Positronic project. Cannot start server.");
            console.error("Navigate to your project directory or use 'positronic project new <name>' to create one.");
            process.exit(1);
        }

        const serverDir = path.join(projectRootPath, '.positronic');
        const srcDir = path.join(serverDir, 'src'); // Still needed for watcher path
        const brainsDir = path.join(projectRootPath, 'brains'); // Still needed for watcher path

        let wranglerProcess: ChildProcess | null = null;
        let watcher: FSWatcher | null = null;

        const cleanup = async () => {
            if (watcher) {
                await watcher.close();
                watcher = null;
            }
            if (wranglerProcess && !wranglerProcess.killed) {
                const killedGracefully = wranglerProcess.kill('SIGTERM');
                if (killedGracefully) {
                    // Wait a short period for potential cleanup within Wrangler
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (!wranglerProcess.killed) { // Check if it terminated
                        console.warn("- Wrangler did not exit after SIGTERM, sending SIGKILL.");
                        wranglerProcess.kill('SIGKILL');
                    }
                } else {
                     // If SIGTERM fails immediately (e.g., process doesn't exist)
                    console.warn("- Failed to send SIGTERM to Wrangler (process might have already exited). Attempting SIGKILL.");
                    wranglerProcess.kill('SIGKILL'); // Force kill if SIGTERM fails
                }
                wranglerProcess = null;
                console.log("- Wrangler process terminated.");
            }
            console.log("Cleanup complete. Exiting.");
            process.exit(0);
        };

        process.on('SIGINT', cleanup); // Catches Ctrl+C
        process.on('SIGTERM', cleanup); // Catches kill commands

        try {
            await setupPositronicServerEnv(
                projectRootPath,
                argv.force,
            );

            // Watcher setup - target the user's brains directory
            watcher = chokidar.watch(path.join(brainsDir, '*.ts'), {
                ignored: [/(^|[\/\\])\../, '**/node_modules/**'], // Ignore dotfiles and node_modules within brains
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: {
                    stabilityThreshold: 200,
                    pollInterval: 100
                }
            });

            const regenerate = async () => {
                await regenerateManifestFile(projectRootPath, srcDir);
            };

            watcher
                .on('add', regenerate)
                .on('change', regenerate)
                .on('unlink', regenerate)
                .on('error', error => console.error(`Watcher error: ${error}`));


            // Start dev server
            const wranglerArgs = ['dev', '--local'];
            if (argv.port) {
                wranglerArgs.push('--port', String(argv.port));
            }

            // Ensure npx is found, prefer local install if available
            const npxCommand = 'npx';

            wranglerProcess = spawn(npxCommand, ['wrangler', ...wranglerArgs], {
                cwd: serverDir,
                stdio: 'inherit', // Show wrangler output directly
                shell: true, // Use shell for better compatibility, especially on Windows
            });

            wranglerProcess.on('close', (code) => {
                if (watcher) {
                     watcher.close();
                     watcher = null;
                }
                process.exit(code ?? 1); // Exit with wrangler's code or 1 if null
            });

            wranglerProcess.on('error', (err) => {
                console.error('Failed to start Wrangler dev server:', err);
                 if (watcher) {
                     watcher.close();
                     watcher = null;
                }
                process.exit(1);
            });

        } catch (error) {
             console.error("An error occurred during server startup:", error);
             await cleanup(); // Attempt cleanup on error
        }
    }
}