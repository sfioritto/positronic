import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ArgumentsCamelCase } from 'yargs';
import type { Workflow } from '@positronic/core'; // Assuming Workflow type might be needed by manifest

// --- Helper Functions (Moved from positronic.ts) ---

// Helper to find project root (Async version used by server command)
async function findProjectRoot(startDir: string): Promise<string | null> {
    let currentDir = path.resolve(startDir);
    while (true) {
        const configPath = path.join(currentDir, 'positronic.config.json');
        try {
            await fsPromises.access(configPath);
            return currentDir; // Found it
        } catch (e) {
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                return null;
            }
            currentDir = parentDir;
        }
    }
}

// Helper function to copy and process a template file for the server
async function copyServerTemplate(
    templateFileName: string,
    destinationDir: string,
    destinationFileName: string,
    projectName: string,
    userCoreVersion: string | null,
    cloudflareDevServerTemplateDir: string // Pass template dir path
): Promise<void> {
    const templatePath = path.join(cloudflareDevServerTemplateDir, templateFileName);
    const destinationPath = path.join(destinationDir, destinationFileName);
    try {
        let content = await fsPromises.readFile(templatePath, 'utf-8');
        content = content.replace(/{{projectName}}/g, projectName);

        if (templateFileName === 'package.json.tpl') {
            const devRootPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;
            if (devRootPath) {
                console.log(` -> Injecting local development paths relative to ${devRootPath} into package.json...`);
                try {
                    const packageJson = JSON.parse(content);
                    const coreDevPath = path.join(devRootPath, 'packages', 'core');
                    const cloudflareDevPath = path.join(devRootPath, 'packages', 'cloudflare');

                    if (packageJson.dependencies && packageJson.dependencies['@positronic/core']) {
                        packageJson.dependencies['@positronic/core'] = `file:${coreDevPath}`;
                        console.log(`    - Using local @positronic/core: file:${coreDevPath}`);
                    }
                    if (packageJson.dependencies && packageJson.dependencies['@positronic/cloudflare']) {
                        packageJson.dependencies['@positronic/cloudflare'] = `file:${cloudflareDevPath}`;
                        console.log(`    - Using local @positronic/cloudflare: file:${cloudflareDevPath}`);
                    }
                    content = JSON.stringify(packageJson, null, 2);
                } catch (parseError: any) {
                     console.error(`   Error parsing server template ${templateFileName} for local path injection: ${parseError.message}`);
                     throw parseError;
                }
            } else if (userCoreVersion) {
                console.log(` -> Syncing @positronic/* versions to user project version: ${userCoreVersion}...`);
                 try {
                    const packageJson = JSON.parse(content);
                    let updated = false;

                    if (packageJson.dependencies && packageJson.dependencies['@positronic/core']) {
                        packageJson.dependencies['@positronic/core'] = userCoreVersion;
                        console.log(`    - Set @positronic/core to ${userCoreVersion}`);
                        updated = true;
                    }
                    if (packageJson.dependencies && packageJson.dependencies['@positronic/cloudflare']) {
                        packageJson.dependencies['@positronic/cloudflare'] = userCoreVersion;
                        console.log(`    - Set @positronic/cloudflare to ${userCoreVersion}`);
                         updated = true;
                    }

                    if (updated) {
                         content = JSON.stringify(packageJson, null, 2);
                    } else {
                         console.log(`    - No matching @positronic/* dependencies found in template to update.`);
                    }
                } catch (parseError: any) {
                     console.error(`   Error parsing server template ${templateFileName} for version syncing: ${parseError.message}`);
                     throw parseError;
                }
            }
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
    const workflowsDir = path.join(projectRootPath, 'workflows');
    const manifestPath = path.join(serverSrcDir, '_manifest.ts');
    console.log(`Generating static manifest for workflows in ${workflowsDir}...`);

    let importStatements = `import type { Workflow } from '@positronic/core';\n`;
    let manifestEntries = '';

    try {
        await fsPromises.mkdir(workflowsDir, { recursive: true });

        const files = await fsPromises.readdir(workflowsDir);
        const workflowFiles = files.filter(file => file.endsWith('.ts') && !file.startsWith('_'));

        for (const file of workflowFiles) {
            const workflowName = path.basename(file, '.ts');
            const importPath = `../../workflows/${workflowName}.js`;
            const importAlias = `wf_${workflowName.replace(/[^a-zA-Z0-9_]/g, '_')}`;

            importStatements += `import * as ${importAlias} from '${importPath}';\n`;
            manifestEntries += `  ${JSON.stringify(workflowName)}: ${importAlias}.default,\n`;
        }

        const manifestContent = `// This file is generated automatically by the Positronic CLI server command. Do not edit directly.\n${importStatements}\nexport const staticManifest: Record<string, Workflow> = {\n${manifestEntries}};\n`;

        await fsPromises.writeFile(manifestPath, manifestContent, 'utf-8');
        console.log(`Static manifest written to ${manifestPath}`);

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.warn(`Workflows directory not found at ${workflowsDir}. Creating an empty manifest.`);
             const manifestContent = `// This file is generated automatically by the Positronic CLI server command. Do not edit directly.\nimport type { Workflow } from '@positronic/core';\n\nexport const staticManifest: Record<string, Workflow> = {};\n`;
             await fsPromises.writeFile(manifestPath, manifestContent, 'utf-8');
        } else {
            console.error(`Error generating static manifest:`, error);
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
    async handle(argv: ArgumentsCamelCase<any>, projectRootPath: string | null): Promise<void> {
        if (!projectRootPath) {
            console.error("Error: Not inside a Positronic project. Cannot start server.");
            console.error("Navigate to your project directory or use 'positronic project new <name>' to create one.");
            process.exit(1);
        }

        console.log(`Operating in Local Development Mode for project: ${projectRootPath}`);
        const serverDir = path.join(projectRootPath, '.positronic');
        const srcDir = path.join(serverDir, 'src');
        const workflowsDir = path.join(projectRootPath, 'workflows');
        const projectName = path.basename(projectRootPath);
        const userPackageJsonPath = path.join(projectRootPath, 'package.json');
        let userCoreVersion: string | null = null;

        let wranglerProcess: ChildProcess | null = null;
        let watcher: FSWatcher | null = null;

        const cleanup = async () => {
            console.log('\nShutting down...');
            if (watcher) {
                console.log('Closing workflow watcher...');
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
            const userPackageJson = JSON.parse(await fsPromises.readFile(userPackageJsonPath, 'utf-8'));
            userCoreVersion = userPackageJson.dependencies?.['@positronic/core'] || userPackageJson.devDependencies?.['@positronic/core'] || null;
            if(userCoreVersion) {
                console.log(`Found user-specified @positronic/core version: ${userCoreVersion}`);
            }
        } catch (error) {
            console.warn("Warning: Could not read project's package.json. Using default @positronic/core version.");
        }

        let setupNeeded = true;
        try {
            await fsPromises.access(serverDir);
            if (argv.force) {
                console.log("--force flag detected. Regenerating server directory...");
                await fsPromises.rm(serverDir, { recursive: true, force: true });
            } else {
                console.log(".positronic server directory already exists. Skipping full setup.");
                console.log("Use --force to regenerate it (this will run npm install again).");
                setupNeeded = false;
            }
        } catch (e) {
            console.log(".positronic server directory not found. Setting it up...");
        }

        if (setupNeeded) {
            try {
                console.log("Creating server directory structure...");
                await fsPromises.mkdir(srcDir, { recursive: true });

                console.log("Copying server templates...");
                 try { await fsPromises.rm(path.join(srcDir, '_manifest.ts'), { force: true }); } catch {}

                // Pass template dir to helper
                await copyServerTemplate('package.json.tpl', serverDir, 'package.json', projectName, userCoreVersion, this.cloudflareDevServerTemplateDir);
                await copyServerTemplate('tsconfig.json.tpl', serverDir, 'tsconfig.json', projectName, userCoreVersion, this.cloudflareDevServerTemplateDir);
                await copyServerTemplate('wrangler.jsonc.tpl', serverDir, 'wrangler.jsonc', projectName, userCoreVersion, this.cloudflareDevServerTemplateDir);
                await copyServerTemplate('src/index.ts.tpl', srcDir, 'index.ts', projectName, userCoreVersion, this.cloudflareDevServerTemplateDir);

                await generateStaticManifest(projectRootPath, srcDir);

                if (!process.env.POSITRONIC_TEST_SKIP_SERVER_INSTALL) {
                    await runNpmInstall(serverDir);
                } else {
                    console.log(" -> Skipping npm install due to POSITRONIC_TEST_SKIP_SERVER_INSTALL flag.");
                }

                console.log("Server setup complete.");
            } catch (error) {
                console.error("Failed to set up the server directory:", error);
                try {
                    await fsPromises.rm(serverDir, { recursive: true, force: true });
                } catch (cleanupError) {
                    console.error("Failed to clean up server directory after setup error:", cleanupError);
                }
                process.exit(1);
            }
        } else {
            console.log("Ensuring static manifest is up-to-date...");
            await generateStaticManifest(projectRootPath, srcDir);
            if (process.env.POSITRONIC_TEST_SKIP_SERVER_INSTALL) {
                 console.log(" -> Skipping potential npm install check due to POSITRONIC_TEST_SKIP_SERVER_INSTALL flag.");
            }
        }

        console.log(`Watching for workflow changes in ${workflowsDir}...`);
        watcher = chokidar.watch(path.join(workflowsDir, '*.ts'), {
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

        console.log("Starting Wrangler dev server...");
        wranglerProcess = spawn('npx', ['wrangler', 'dev', '--local'], {
            cwd: serverDir,
            stdio: 'inherit',
            shell: true,
        });

        wranglerProcess.on('close', (code) => {
            console.log(`Wrangler dev server exited with code ${code}`);
            if (watcher) {
                 console.log("Closing workflow watcher as Wrangler stopped.");
                 watcher.close();
                 watcher = null;
            }
            process.exit(code ?? 1);
        });

        wranglerProcess.on('error', (err) => {
            console.error('Failed to start Wrangler dev server:', err);
             if (watcher) {
                 console.log("Closing workflow watcher due to Wrangler start error.");
                 watcher.close();
                 watcher = null;
            }
            process.exit(1);
        });
    }
}