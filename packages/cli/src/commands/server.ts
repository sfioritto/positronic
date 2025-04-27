import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import { renderPackageJson } from './helpers.js';
import type { ArgumentsCamelCase } from 'yargs';


// Helper function to copy and process a template file for the server
async function copyServerTemplate(
    templateFileName: string,
    destinationDir: string,
    projectName: string,
    cloudflareDevServerTemplateDir: string,
    userCoreVersion?: string,
) {
    const destinationFileName = path.basename(templateFileName).replace('.tpl', '');
    const templatePath = path.join(cloudflareDevServerTemplateDir, templateFileName);
    const destinationPath = path.join(destinationDir, destinationFileName);

    let content = await fsPromises.readFile(templatePath, 'utf-8');
    content = content.replace(/{{projectName}}/g, projectName);

    if (templateFileName === 'package.json.tpl') {
        const packageJson = await renderPackageJson(
            projectName,
            cloudflareDevServerTemplateDir,
            userCoreVersion
        );
        content = JSON.stringify(packageJson, null, 2);
    }

    await fsPromises.writeFile(destinationPath, content);
}

// Helper to run npm install
function runNpmInstall(targetDir: string): Promise<void> {
    const npmInstall = spawn('npm', ['install'], {
        cwd: targetDir,
        stdio: 'inherit',
        shell: true
    });

    return new Promise((resolve, reject) => {
        npmInstall.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`npm install failed in ${targetDir}`));
            }
        });
        npmInstall.on('error', (err) => {
            reject(err);
        });
    });
}

// Function to generate the static manifest file
async function generateStaticManifest(projectRootPath: string, serverSrcDir: string) {
    const brainsDir = path.join(projectRootPath, 'brains');
    const manifestPath = path.join(serverSrcDir, '_manifest.ts');

    let importStatements = `import type { Workflow } from '@positronic/core';\n`;
    let manifestEntries = '';

    try {
        const files = await fsPromises.readdir(brainsDir);
        const brainFiles = files.filter(file => file.endsWith('.ts') && !file.startsWith('_'));

        for (const file of brainFiles) {
            const brainName = path.basename(file, '.ts');
            const importPath = `../../brains/${brainName}.js`;
            const importAlias = `brain_${brainName.replace(/[^a-zA-Z0-9_]/g, '_')}`;

            importStatements += `import * as ${importAlias} from '${importPath}';\n`;
            manifestEntries += `  ${JSON.stringify(brainName)}: ${importAlias}.default as Workflow,\n`;
        }

        const manifestContent = `// This file is generated automatically by the Positronic CLI server command. Do not edit directly.\n${importStatements}\nexport const staticManifest: Record<string, Workflow> = {\n${manifestEntries}};\n`;

        await fsPromises.writeFile(manifestPath, manifestContent, 'utf-8');

    } catch (error: any) {
        throw error;
    }
}

/**
 * Sets up the .positronic server environment directory.
 * Creates directories, copies templates, installs dependencies, and generates the manifest.
 */
export async function setupPositronicServerEnv(
    projectRootPath: string,
    cloudflareDevServerTemplateDir: string,
    forceSetup: boolean = false,
    skipNpmInstall: boolean = false
) {
    const serverDir = path.join(projectRootPath, '.positronic');
    const srcDir = path.join(serverDir, 'src');
    const projectName = path.basename(projectRootPath);
    const userPackageJsonPath = path.join(projectRootPath, 'package.json');
    // Read user project's package.json for version syncing
    const userPackageJsonContent = await fsPromises.readFile(userPackageJsonPath, 'utf-8');
    const userPackageJson = JSON.parse(userPackageJsonContent);
    const userCoreVersion = userPackageJson.dependencies?.['@positronic/core'];

    // Determine if a full server environment setup (copying templates, npm install)
    // is required.
    // The logic starts by assuming setup *is* needed (`setupNeeded = true`).
    // It then checks if the `.positronic` directory exists using `fsPromises.access`.
    // - If `access` succeeds (directory exists):
    //   - Check `forceSetup`: If true, delete the old dir, create the new `src` dir,
    //     and `setupNeeded` remains `true`.
    //   - Check `forceSetup`: If false, the directory exists and we aren't forcing a
    //     rebuild, so set `setupNeeded = false`.
    // - If `access` fails (directory doesn't exist, jumps to `catch`):
    //   - Create the necessary `src` directory.
    //   - `setupNeeded` remains `true` (its initial value) because the directory had
    //      to be created.
    // Ultimately, `setupNeeded` will only be `false` if the directory existed *and*
    // `forceSetup` was not requested.
    let setupNeeded = true;
    try {
        await fsPromises.access(serverDir);
        if (forceSetup) {
            await fsPromises.rm(serverDir, { recursive: true, force: true });
            await fsPromises.mkdir(srcDir, { recursive: true });
        } else {
            setupNeeded = false;
        }
    } catch (e) {
        // Directory doesn't exist, create it
        await fsPromises.mkdir(srcDir, { recursive: true });
    }

    // Generate the static manifest, regenerate it every time the command is run
    await generateStaticManifest(projectRootPath, srcDir);

    // Perform full template copy and install only if needed
    if (setupNeeded) {
        try {
            // Pass template dir to helper
            await copyServerTemplate('package.json.tpl', serverDir, projectName, cloudflareDevServerTemplateDir, userCoreVersion);
            await copyServerTemplate('tsconfig.json.tpl', serverDir, projectName, cloudflareDevServerTemplateDir, userCoreVersion);
            await copyServerTemplate('wrangler.jsonc.tpl', serverDir, projectName, cloudflareDevServerTemplateDir, userCoreVersion);
            await copyServerTemplate('src/index.ts.tpl', srcDir, projectName, cloudflareDevServerTemplateDir);

            // Only run install if the flag isn't set and setup is needed
            if (!skipNpmInstall) {
                await runNpmInstall(serverDir);
            }
        } catch (error) {
            console.error("Failed to set up the .positronic directory:", error);
            // Attempt cleanup only if we created the directory initially during this run
            try {
                await fsPromises.rm(serverDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error("Failed to clean up server directory after setup error:", cleanupError);
            }
            throw error; // Re-throw error to signal failure
        }
    }
}

// --- ServerCommand Class ---

export class ServerCommand {
    private cloudflareDevServerTemplateDir: string;

    // Constructor can take dependencies like template paths if needed
    constructor(cloudflareDevServerTemplateDir: string) {
        this.cloudflareDevServerTemplateDir = cloudflareDevServerTemplateDir;
    }

    // Main handler logic from handleServer
    async handle(argv: ArgumentsCamelCase<any>, projectRootPath: string | null) {
        if (!projectRootPath) {
            console.error("Error: Not inside a Positronic project. Cannot start server.");
            console.error("Navigate to your project directory or use 'positronic project new <name>' to create one.");
            process.exit(1);
        }

        const serverDir = path.join(projectRootPath, '.positronic');
        const srcDir = path.join(serverDir, 'src');
        const brainsDir = path.join(projectRootPath, 'brains');

        let wranglerProcess: ChildProcess | null = null;
        let watcher: FSWatcher | null = null;

        const cleanup = async () => {
            if (watcher) {
                await watcher.close();
                watcher = null;
            }
            if (wranglerProcess && !wranglerProcess.killed) {
                const killed = wranglerProcess.kill('SIGTERM');
                 if (!killed) {
                    console.warn("Failed to kill Wrangler process with SIGTERM, attempting SIGKILL.");
                    wranglerProcess.kill('SIGKILL');
                }
                wranglerProcess = null;
            }
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        try {
            // Setup the .positronic environment before starting watcher/wrangler
            await setupPositronicServerEnv(
                projectRootPath,
                this.cloudflareDevServerTemplateDir,
                argv.force as boolean,
                process.env.POSITRONIC_TEST_SKIP_SERVER_INSTALL === 'true'
            );

            // Watcher setup remains the same, but uses updated generateStaticManifest
            console.log(`Watching for brain changes in ${brainsDir}...`);
            watcher = chokidar.watch(path.join(brainsDir, '*.ts'), {
                ignored: /(^|[\/\\])\../,
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: {
                    stabilityThreshold: 200,
                    pollInterval: 100
                }
            });

            const regenerate = async (filePath?: string) => {
                console.log(`Detected change${filePath ? ` in ${path.basename(filePath)}` : ''}. Regenerating static manifest...`);
                try {
                    // Use the standalone generateStaticManifest function
                    await generateStaticManifest(projectRootPath, srcDir);
                    console.log("Manifest regeneration complete. Wrangler should detect the change and reload.");
                } catch (error) {
                    console.error("Error regenerating manifest on change:", error);
                }
            };

            watcher
                .on('add', path => regenerate(path))
                .on('change', path => regenerate(path))
                .on('unlink', path => regenerate(path))
                .on('error', error => console.error(`Watcher error: ${error}`));


            // Build Wrangler args dynamically
            const wranglerArgs = ['dev', '--local'];
            if (argv.port) {
                wranglerArgs.push('--port', String(argv.port));
            }

            wranglerProcess = spawn('npx', ['wrangler', ...wranglerArgs], {
                cwd: serverDir,
                stdio: 'inherit',
                shell: true,
            });

            wranglerProcess.on('close', (code) => {
                console.log(`Wrangler dev server exited with code ${code}`);
                if (watcher) {
                     console.log("Closing brain watcher as Wrangler stopped.");
                     watcher.close();
                     watcher = null;
                }
                process.exit(code ?? 1);
            });

            wranglerProcess.on('error', (err) => {
                console.error('Failed to start Wrangler dev server:', err);
                 if (watcher) {
                     console.log("Closing brain watcher due to Wrangler start error.");
                     watcher.close();
                     watcher = null;
                }
                process.exit(1);
            });

        } catch (error) {
             console.error("An error occurred during server startup:", error);
             // Ensure cleanup is attempted even if setup fails
             await cleanup(); // Call cleanup, which will exit
             // process.exit(1); // Exit handled by cleanup
        }
    }
}