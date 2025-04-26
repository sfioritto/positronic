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
    destinationFileName: string,
    projectName: string,
    cloudflareDevServerTemplateDir: string,
    userCoreVersion?: string,
) {
    const templatePath = path.join(cloudflareDevServerTemplateDir, templateFileName);
    const destinationPath = path.join(destinationDir, destinationFileName);
    try {
        let content = await fsPromises.readFile(templatePath, 'utf-8');
        content = content.replace(/{{projectName}}/g, projectName);

        if (templateFileName === 'package.json.tpl') {
            const packageJson = await renderPackageJson(
                projectName,
                userCoreVersion
            );
            content = JSON.stringify(packageJson, null, 2);
        }

        await fsPromises.writeFile(destinationPath, content);
        console.log(`   Created ${destinationFileName}`);

    } catch (error: any) {
        console.error(`   Error processing server template ${templateFileName}: ${error.message}`);
        throw error;
    }
}

// Helper to run npm install
function runNpmInstall(targetDir: string): Promise<void> {
     console.log(` -> Running npm install in ${targetDir}...`);
    const npmInstall = spawn('npm', ['install'], {
        cwd: targetDir,
        stdio: 'inherit',
        shell: true
    });

    return new Promise((resolve, reject) => {
        npmInstall.on('close', (code) => {
            if (code === 0) {
                console.log(` -> npm install completed successfully.`);
                resolve();
            } else {
                console.error(` -> npm install failed with code ${code}.`);
                reject(new Error(`npm install failed in ${targetDir}`));
            }
        });
        npmInstall.on('error', (err) => {
            console.error(` -> Failed to start npm install in ${targetDir}:`, err);
            reject(err);
        });
    });
}

// Function to generate the static manifest file
async function generateStaticManifest(projectRootPath: string, serverSrcDir: string): Promise<void> {
    const brainsDir = path.join(projectRootPath, 'brains');
    const manifestPath = path.join(serverSrcDir, '_manifest.ts');
    console.log(`Generating static manifest for brains in ${brainsDir}...`);

    let importStatements = `import type { Workflow } from '@positronic/core';\n`;
    let manifestEntries = '';

    try {
        await fsPromises.mkdir(brainsDir, { recursive: true });

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
        console.log(`Static manifest written to ${manifestPath}`);

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.warn(`Brains directory not found at ${brainsDir}. Creating an empty manifest.`);
             const manifestContent = `// This file is generated automatically by the Positronic CLI server command. Do not edit directly.\nimport type { Workflow } from '@positronic/core';\n\nexport const staticManifest: Record<string, Workflow> = {};\n`;
             await fsPromises.writeFile(manifestPath, manifestContent, 'utf-8');
        } else {
            console.error(`Error generating static manifest:`, error);
        }
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
): Promise<void> {
    console.log("Setting up or verifying .positronic server environment...");
    const serverDir = path.join(projectRootPath, '.positronic');
    const srcDir = path.join(serverDir, 'src');
    const projectName = path.basename(projectRootPath);
    const userPackageJsonPath = path.join(projectRootPath, 'package.json');
    let userCoreVersion: string | undefined;

    // Read user project's package.json for version syncing
    try {
        const userPackageJsonContent = await fsPromises.readFile(userPackageJsonPath, 'utf-8');
        const userPackageJson = JSON.parse(userPackageJsonContent);
        // Prefer dependency, then devDependency
        userCoreVersion = userPackageJson.dependencies?.['@positronic/core']
                       || userPackageJson.devDependencies?.['@positronic/core']
                       || null;
        if (userCoreVersion) {
            // Check if it's a file path (from project new command)
            if (userCoreVersion.startsWith('file:')) {
                console.log(`Detected local @positronic/core path in project: ${userCoreVersion}`);
                // Server setup will prefer POSITRONIC_PACKAGES_DEV_PATH if set, otherwise this won't be used by copyServerTemplate.
            } else {
                 console.log(`Found user-specified @positronic/core version: ${userCoreVersion}`);
            }
        }
    } catch (error: any) {
        console.warn(`Warning: Could not read project's package.json at ${userPackageJsonPath}. Version syncing for .positronic may not work as expected.`);
        // Allow continuing, setup might still work using defaults or POSITRONIC_PACKAGES_DEV_PATH
    }

    let setupNeeded = true;
    try {
        await fsPromises.access(serverDir);
        if (forceSetup) {
            console.log("--force specified or initial setup: Regenerating server directory...");
            await fsPromises.rm(serverDir, { recursive: true, force: true });
            await fsPromises.mkdir(srcDir, { recursive: true }); // Recreate after rm
        } else {
            console.log(".positronic server directory already exists.");
            setupNeeded = false;
        }
    } catch (e) {
        // Directory doesn't exist, create it
        console.log(".positronic server directory not found. Creating it...");
        await fsPromises.mkdir(srcDir, { recursive: true });
    }

    // Perform full template copy and install only if needed
    if (setupNeeded) {
        try {
            console.log("Creating server directory structure and copying templates...");
             try { await fsPromises.rm(path.join(srcDir, '_manifest.ts'), { force: true }); } catch {} // Ensure old manifest is gone

            // Pass template dir to helper
            await copyServerTemplate('package.json.tpl', serverDir, 'package.json', projectName, cloudflareDevServerTemplateDir, userCoreVersion);
            await copyServerTemplate('tsconfig.json.tpl', serverDir, 'tsconfig.json', projectName, cloudflareDevServerTemplateDir, userCoreVersion);
            await copyServerTemplate('wrangler.jsonc.tpl', serverDir, 'wrangler.jsonc', projectName, cloudflareDevServerTemplateDir, userCoreVersion);
            await copyServerTemplate('src/index.ts.tpl', srcDir, 'index.ts', projectName, cloudflareDevServerTemplateDir);

            // Generate initial manifest
            await generateStaticManifest(projectRootPath, srcDir);

            // Only run install if the flag isn't set
            if (!skipNpmInstall) {
                await runNpmInstall(serverDir);
            }
        } catch (error) {
            console.error("Failed to set up the .positronic directory:", error);
            // Attempt cleanup only if we created the directory initially
            if (setupNeeded) {
                try {
                    console.log("Attempting cleanup of partially created .positronic directory...");
                    await fsPromises.rm(serverDir, { recursive: true, force: true });
                } catch (cleanupError) {
                    console.error("Failed to clean up server directory after setup error:", cleanupError);
                }
            }
            throw error; // Re-throw error to signal failure
        }
    } else {
        // If setup wasn't needed, still ensure the manifest is up-to-date
        console.log("Ensuring static manifest is up-to-date...");
        await generateStaticManifest(projectRootPath, srcDir);
        // Optional: Could add a check here to see if npm install is needed based on package.json changes, but maybe too complex for now.
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
    async handle(argv: ArgumentsCamelCase<any>, projectRootPath: string | null): Promise<void> {
        if (!projectRootPath) {
            console.error("Error: Not inside a Positronic project. Cannot start server.");
            console.error("Navigate to your project directory or use 'positronic project new <name>' to create one.");
            process.exit(1);
        }

        console.log(`Starting server for project: ${projectRootPath}`);
        const serverDir = path.join(projectRootPath, '.positronic'); // Needed for wrangler cwd
        const srcDir = path.join(serverDir, 'src'); // Needed for manifest updates
        const brainsDir = path.join(projectRootPath, 'brains');

        let wranglerProcess: ChildProcess | null = null;
        let watcher: FSWatcher | null = null;

        const cleanup = async () => {
            console.log('\nShutting down...');
            if (watcher) {
                console.log('Closing brain watcher...');
                await watcher.close();
                watcher = null;
            }
            if (wranglerProcess && !wranglerProcess.killed) {
                console.log('Stopping Wrangler dev server...');
                const killed = wranglerProcess.kill('SIGTERM');
                 if (!killed) {
                    console.warn("Failed to kill Wrangler process with SIGTERM, attempting SIGKILL.");
                    wranglerProcess.kill('SIGKILL');
                }
                wranglerProcess = null;
            }
            console.log("Cleanup complete.");
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

            // Wrangler start logic remains the same
            console.log("Starting Wrangler dev server in .positronic...");
            wranglerProcess = spawn('npx', ['wrangler', 'dev', '--local'], {
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