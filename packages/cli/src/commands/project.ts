import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { setupPositronicServerEnv } from './server.js';
import type { ArgumentsCamelCase } from 'yargs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesBasePath = path.resolve(__dirname, '../../templates');
const templatesPath = path.join(templatesBasePath, 'new-project');

async function copyTemplate(
    templateFileName: string,
    destinationPath: string,
    projectName: string
) {
    const templatePath = path.join(templatesPath, templateFileName);
    const template = await fsPromises.readFile(templatePath, 'utf-8');

    // Check for POSITRONIC_PACKAGES_DEV_PATH, if set, use it to replace @positronic/core with a local path for doing development work on the core package
    const devRootPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;

    let renderedTemplate = template.replace(/{{projectName}}/g, projectName);
    if (templateFileName === 'package.json.tpl' &&
        devRootPath
    ) {
        const packageJson = JSON.parse(renderedTemplate);
        const coreDevPath = path.join(devRootPath, 'packages', 'core');
        if (packageJson.dependencies['@positronic/core']
        ) {
            packageJson.dependencies['@positronic/core'] = `file:${coreDevPath}`;
        }
        renderedTemplate = JSON.stringify(packageJson, null, 2);
    }

    await fsPromises.writeFile(destinationPath, renderedTemplate);
}

interface AddProjectArgs {
  name: string;
  url: string;
}

interface SelectProjectArgs {
  name?: string;  // Optional because it can be interactive
}

interface CreateProjectArgs {
  name: string;
}

export class ProjectCommand {
    private isLocalDevMode: boolean;

    constructor(isLocalDevMode: boolean) {
        this.isLocalDevMode = isLocalDevMode;
    }

    /**
     * Handles the 'positronic project add <name> --url <url>' command.
     * Adds a project configuration to the global store.
     */
    add({ name, url }: ArgumentsCamelCase<AddProjectArgs>): void {
        console.log('add', name, url);
    }

    /**
     * Handles the 'positronic project list' command.
     * Lists configured remote projects (Global Mode) or shows current local project path (Local Dev Mode).
     */
    list() {
        console.log('list');
    }

    /**
     * Handles the 'positronic project select [name]' command.
     * Selects the active remote project for subsequent commands.
     * Only available in Global Mode.
     */
    select({ name }: ArgumentsCamelCase<SelectProjectArgs>): void {
        console.log('select', name);
    }

    /**
     * Handles the 'positronic project show' command.
     * Shows details of the active project (remote in Global Mode, local in Local Dev Mode).
     */
    show(): void {
        console.log('show');
    }

    /**
     * Handles the 'positronic new <project-name>' command.
     * Creates a new project directory structure and populates it with template files.
     * Also sets up the .positronic server environment.
     */
    async create({ name: projectName }: ArgumentsCamelCase<CreateProjectArgs>) {
        const projectPath = path.resolve(process.cwd(), projectName);
        const brainsPath = path.join(projectPath, 'brains');
        const cloudflareDevServerTemplateDir = path.join(templatesBasePath, 'cloudflare-dev-server');

        // 1. Check if directory already exists
        try {
            await fsPromises.access(projectPath);
            console.error(`Error: Directory '${projectName}' already exists at ${projectPath}.`);
            process.exit(1);
        } catch {
            // ENOENT is expected, meaning the directory doesn't exist, proceed
        }

        // 2. Create project directories
        await fsPromises.mkdir(projectPath, { recursive: true });
        await fsPromises.mkdir(brainsPath, { recursive: true });


        // 3. Copy and process template files
        await copyTemplate('package.json.tpl', path.join(projectPath, 'package.json'), projectName);
        await copyTemplate('tsconfig.json.tpl', path.join(projectPath, 'tsconfig.json'), projectName);
        await copyTemplate('positronic.config.json.tpl', path.join(projectPath, 'positronic.config.json'), projectName);
        await copyTemplate('.gitignore.tpl', path.join(projectPath, '.gitignore'), projectName);
        await copyTemplate('brains/example.ts.tpl', path.join(brainsPath, 'example.ts'), projectName);


        // 4. Run npm install for the main project
        const npmInstall = spawn('npm', ['install'], {
            cwd: projectPath,
            stdio: 'inherit',
            shell: true
        });

        await new Promise<void>((resolve, reject) => {
             npmInstall.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Project npm install failed with code ${code}`));
                }
            });
            npmInstall.on('error', (err) => {
                reject(err);
            });
        });

        // 5. Set up the .positronic server environment
        await setupPositronicServerEnv(
            projectPath,                    // Path to the newly created project
            cloudflareDevServerTemplateDir, // Path to the server templates
            true,                           // Force setup (it's a new project)
            false                           // Do not skip npm install for server
        );


        console.log(`Success! Created project '${projectName}' at ${projectPath}`);
        console.log("Next steps:");
        console.log(`  cd ${projectName}`);
        console.log(`  positronic server  # Start the local development server`);
        console.log(`  positronic run example # Run the example brain (in another terminal)`);

    }
}