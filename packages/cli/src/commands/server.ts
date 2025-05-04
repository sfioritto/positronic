import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import caz from 'caz';
// @ts-ignore Could not find a declaration file for module '@positronic/template-cloudflare'.
import pkg from '@positronic/template-cloudflare';
const { generateManifest: regenerateManifestFile } = pkg;

/**
 * Sets up the .positronic server environment directory using caz.
 */
export async function setupPositronicServerEnv(
    projectRootPath: string,
    forceSetup: boolean = false
) {
    const serverDir = path.join(projectRootPath, '.positronic');
    const devPath = process.env.POSITRONIC_LOCAL_PATH;
    let cloudflareTemplate: string;

    if (devPath) {
        console.log(`Using local development cloudflare template from: ${devPath}`);
        cloudflareTemplate = path.resolve(devPath, 'packages', 'template-cloudflare');
    } else {
        cloudflareTemplate = '@positronic/template-cloudflare';
    }

    const serverDirExists = await fsPromises.access(serverDir).then(() => true).catch(() => false);

    if (forceSetup) {
        await caz.default(cloudflareTemplate, serverDir, {
            force: forceSetup,
        });
    } else if (!serverDirExists) {
        await caz.default(cloudflareTemplate, serverDir, {
            force: forceSetup,
        });
    }
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