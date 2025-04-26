import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { setupPositronicServerEnv } from './server.js';

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

export class ProjectCommand {
    // Add instance variables for mode and path
    private isLocalDevMode: boolean;

    // Constructor accepts shared config, API clients, etc. later
    // Update constructor to accept mode and path
    constructor(isLocalDevMode: boolean) {
        this.isLocalDevMode = isLocalDevMode;
    }

    /**
     * Handles the 'positronic project add <name> --url <url>' command.
     * Adds a project configuration to the global store.
     * Only available in Global Mode.
     */
    add(argv: any): void {
        // Use instance variable for check
        if (this.isLocalDevMode) {
            // This check is technically redundant due to yargs structure in positronic.ts,
            // but good defensive programming.
            console.error("Error: Project add command is not available in Local Development Mode.");
            process.exit(1);
        }
        // TODO: Implement storage of project name and URL in global config
        // Example: Config.addProject(argv.name, argv.url);
    }

    /**
     * Handles the 'positronic project list' command.
     * Lists configured remote projects (Global Mode) or shows current local project path (Local Dev Mode).
     */
    list(): void {
        // Use instance variable
        if (this.isLocalDevMode) {
            // Use instance variable
            // TODO: Implement detailed listing logic for local project context if needed
        } else {
            // TODO: Implement listing logic for remote projects from global config
            // Example: const projects = Config.listProjects(); display projects;
        }
    }

    /**
     * Handles the 'positronic project select [name]' command.
     * Selects the active remote project for subsequent commands.
     * Only available in Global Mode.
     */
    select(argv: any): void {
         // Use instance variable (though this method is only called in Global Mode)
         if (this.isLocalDevMode) {
             console.error("Internal Error: Select command called in Local Development Mode.");
             process.exit(1);
         }
        if (argv.name) {
            // TODO: Implement setting the active remote project (and its URL) in global config
            // Example: Config.setActiveProject(argv.name);
        } else {
            // TODO: Implement interactive selection from configured remote projects
            // Example: const selected = await promptUserToSelect(Config.listProjects()); Config.setActiveProject(selected);
        }
    }

    /**
     * Handles the 'positronic project show' command.
     * Shows details of the active project (remote in Global Mode, local in Local Dev Mode).
     */
    show(): void {
        // Use instance variable
        if (this.isLocalDevMode) {
            // Use instance variable
            // TODO: Implement logic to show more details of the project in the CWD if needed
        } else {
            // TODO: Implement logic to show the currently selected remote project from global config
            // Example: const activeProject = Config.getActiveProject(); display activeProject details;
        }
    }

    /**
     * Handles the 'positronic new <project-name>' command.
     * Creates a new project directory structure and populates it with template files.
     * Also sets up the .positronic server environment.
     * Only available in Global Mode.
     */
    async create(argv: any): Promise<void> { // Make method async
        // Use instance variable
        if (this.isLocalDevMode) {
            console.error("Error: 'positronic project new' is not available when already inside a project (Local Development Mode).");
            process.exit(1);
        }

        const projectName: string = argv.name;
        if (!projectName || typeof projectName !== 'string') {
            console.error("Error: Project name must be provided.");
            process.exit(1);
        }

        const projectPath = path.resolve(process.cwd(), projectName);
        const brainsPath = path.join(projectPath, 'brains');
        const cloudflareDevServerTemplateDir = path.join(templatesBasePath, 'cloudflare-dev-server');

        // 1. Check if directory already exists
        try {
            await fsPromises.access(projectPath);
            // If access doesn't throw, the directory exists
            console.error(`Error: Directory '${projectName}' already exists at ${projectPath}.`);
            process.exit(1);
        } catch (error: any) {
            // ENOENT is expected, meaning the directory doesn't exist, proceed
            if (error.code !== 'ENOENT') {
                console.error(`Error checking directory: ${error.message}`);
                process.exit(1);
            }
        }

        // 2. Create project directories
        try {
            console.log(`Creating project directory '${projectName}' at ${projectPath}...`);
            await fsPromises.mkdir(projectPath, { recursive: true });
            await fsPromises.mkdir(brainsPath, { recursive: true });
             console.log("Project directories created.");
        } catch (error: any) {
            console.error(`Error creating project directories: ${error.message}`);
            process.exit(1);
        }

        // 3. Copy and process template files
        try {
            console.log("Copying project template files...");
            await copyTemplate('package.json.tpl', path.join(projectPath, 'package.json'), projectName);
            await copyTemplate('tsconfig.json.tpl', path.join(projectPath, 'tsconfig.json'), projectName);
            await copyTemplate('positronic.config.json.tpl', path.join(projectPath, 'positronic.config.json'), projectName);
            await copyTemplate('.gitignore.tpl', path.join(projectPath, '.gitignore'), projectName);
            await copyTemplate('brains/example.ts.tpl', path.join(brainsPath, 'example.ts'), projectName);
             console.log("Project template files copied.");
        } catch (error) {
            // Error already logged in copyTemplate, just exit
            console.error('Failed to copy template files. Aborting.');
            await fsPromises.rm(projectPath, { recursive: true, force: true }); // Cleanup
            process.exit(1);
        }

        // 4. Run npm install for the main project
        console.log("Running npm install for the project...");
        const npmInstall = spawn('npm', ['install'], {
            cwd: projectPath,
            stdio: 'inherit',
            shell: true
        });

        await new Promise<void>((resolve, reject) => {
             npmInstall.on('close', (code) => {
                if (code === 0) {
                    console.log("Project npm install completed successfully.");
                    resolve();
                } else {
                    console.error(`
Project npm install failed with code ${code}.`);
                    console.error('Please check the errors above.');
                    reject(new Error(`Project npm install failed with code ${code}`));
                }
            });
            npmInstall.on('error', (err) => {
                console.error(`
Failed to start project npm install process: ${err}`);
                reject(err);
            });
        });

        // 5. Set up the .positronic server environment
        try {
            console.log("\nSetting up the local development server environment (.positronic)...");
            await setupPositronicServerEnv(
                projectPath,                    // Path to the newly created project
                cloudflareDevServerTemplateDir, // Path to the server templates
                true,                           // Force setup (it's a new project)
                false                           // Do not skip npm install for server
            );
            console.log(".positronic environment setup complete.");
        } catch (error) {
            console.error("\nFailed to set up the .positronic server environment:", error);
            console.error("Project created, but the local server environment setup failed.");
            console.error("You might need to run 'positronic server --force' later to fix this.");
            // Don't necessarily need to exit, the project itself was created
            // process.exit(1); // Or maybe we should exit?
        }

        console.log(`
Success! Created project '${projectName}' at ${projectPath}
`);
        console.log("Next steps:");
        console.log(`  cd ${projectName}`);
        console.log(`  positronic server  # Start the local development server`);
        console.log(`  positronic run example # Run the example brain (in another terminal)`);

    }
}