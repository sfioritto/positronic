import * as fs from 'fs';
import * as path from 'path';
// Import Node.js built-in for running commands
import { execSync } from 'child_process';
// Import templates
import * as fsPromises from 'fs/promises'; // Use promises version
import { spawn } from 'child_process';
import { fileURLToPath } from 'url'; // To resolve __dirname in ES modules

// Helper to resolve template paths relative to the current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Assuming templates are inside the cli package at packages/cli/templates
// Compiled file likely at packages/cli/dist/commands/project.js
// Need to go up 2 levels to packages/cli/, then into templates/
const templatesBaseDir = path.resolve(__dirname, '../../templates');
const newProjectTemplateDir = path.join(templatesBaseDir, 'new-project');

// Helper function to copy and process a template file
async function copyTemplate(
    templateFileName: string,
    destinationPath: string,
    projectName: string
): Promise<void> {
    const templatePath = path.join(newProjectTemplateDir, templateFileName);
    try {
        const content = await fsPromises.readFile(templatePath, 'utf-8');
        const processedContent = content.replace(/{{projectName}}/g, projectName);
        await fsPromises.writeFile(destinationPath, processedContent);
        console.log(`Created ${path.basename(destinationPath)}`);
    } catch (error: any) {
        console.error(`Error processing template ${templateFileName}: ${error.message}`);
        throw error; // Re-throw to stop the process
    }
}

export class ProjectCommand {
    // Add instance variables for mode and path
    private isLocalDevMode: boolean;
    private projectRootPath: string | null;

    // Constructor accepts shared config, API clients, etc. later
    // Update constructor to accept mode and path
    constructor(isLocalDevMode: boolean, projectRootPath: string | null) {
        this.isLocalDevMode = isLocalDevMode;
        this.projectRootPath = projectRootPath;
    }

    /**
     * Handles the 'positronic project add <name> --url <url>' command.
     * Adds a project configuration to the global store.
     * Only available in Global Mode.
     */
    add(argv: any): void {
        console.log(`Adding project ${argv.name} with URL: ${argv.url}`);
        // Use instance variable for check
        if (this.isLocalDevMode) {
            // This check is technically redundant due to yargs structure in positronic.ts,
            // but good defensive programming.
            console.error("Error: Project add command is not available in Local Development Mode.");
            process.exit(1);
        }
        // TODO: Implement storage of project name and URL in global config
        // Example: Config.addProject(argv.name, argv.url);
        console.log(`(Placeholder: Project ${argv.name} configuration would be saved here)`);
    }

    /**
     * Handles the 'positronic project list' command.
     * Lists configured remote projects (Global Mode) or shows current local project path (Local Dev Mode).
     */
    list(): void {
        // Use instance variable
        if (this.isLocalDevMode) {
            console.log(`Operating in Local Development Mode.`);
            // Use instance variable
            console.log(`Current project path: ${this.projectRootPath}`);
            // TODO: Implement detailed listing logic for local project context if needed
        } else {
            console.log('Listing all configured remote projects:');
            // TODO: Implement listing logic for remote projects from global config
            // Example: const projects = Config.listProjects(); display projects;
            console.log('(Placeholder: Configured projects would be listed here)');
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
            console.log(`Selecting project: ${argv.name}`);
            // TODO: Implement setting the active remote project (and its URL) in global config
            // Example: Config.setActiveProject(argv.name);
            console.log(`(Placeholder: Project ${argv.name} would be set as active here)`);
        } else {
            console.log('Interactive project selection (not implemented):');
            // TODO: Implement interactive selection from configured remote projects
            // Example: const selected = await promptUserToSelect(Config.listProjects()); Config.setActiveProject(selected);
            console.log('(Placeholder: Interactive selection UI would be shown here)');
        }
    }

    /**
     * Handles the 'positronic project show' command.
     * Shows details of the active project (remote in Global Mode, local in Local Dev Mode).
     */
    show(): void {
        // Use instance variable
        if (this.isLocalDevMode) {
            console.log(`Operating in Local Development Mode.`);
            // Use instance variable
            console.log(`Current project path: ${this.projectRootPath}`);
            // TODO: Implement logic to show more details of the project in the CWD if needed
        } else {
            console.log('Showing active remote project:');
            // TODO: Implement logic to show the currently selected remote project from global config
            // Example: const activeProject = Config.getActiveProject(); display activeProject details;
             console.log('(Placeholder: Details of the active remote project would be shown here)');
        }
    }

    /**
     * Handles the 'positronic new <project-name>' command.
     * Creates a new project directory structure and populates it with template files.
     * Only available in Global Mode.
     */
    async create(argv: any): Promise<void> { // Make method async
        // Use instance variable
        if (this.isLocalDevMode) {
            console.error("Error: 'positronic project new' is not available when already inside a project (Local Development Mode).");
            process.exit(1);
        }

        const projectName: string = argv['project-name'];
        if (!projectName || typeof projectName !== 'string') {
            console.error("Error: Project name must be provided.");
            process.exit(1);
        }

        const projectPath = path.resolve(process.cwd(), projectName);
        const workflowsPath = path.join(projectPath, 'workflows');

        console.log(`Creating new Positronic project '${projectName}' at ${projectPath}...`);

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
            await fsPromises.mkdir(projectPath, { recursive: true });
            await fsPromises.mkdir(workflowsPath, { recursive: true });
            console.log('Created project directories.');
        } catch (error: any) {
            console.error(`Error creating project directories: ${error.message}`);
            process.exit(1);
        }

        // 3. Copy and process template files
        console.log('Copying template files...');
        try {
            await copyTemplate('package.json.tpl', path.join(projectPath, 'package.json'), projectName);
            await copyTemplate('tsconfig.json.tpl', path.join(projectPath, 'tsconfig.json'), projectName);
            await copyTemplate('positronic.config.json.tpl', path.join(projectPath, 'positronic.config.json'), projectName);
            await copyTemplate('.gitignore.tpl', path.join(projectPath, '.gitignore'), projectName);
            await copyTemplate('workflows/example.ts.tpl', path.join(workflowsPath, 'example.ts'), projectName);
        } catch (error) {
            // Error already logged in copyTemplate, just exit
            console.error('Failed to copy template files. Aborting.');
            // Consider cleanup? fs.rm(projectPath, { recursive: true, force: true });
            process.exit(1);
        }

        // 4. Run npm install
        console.log('Installing dependencies using npm...');
        const npmInstall = spawn('npm', ['install'], {
            cwd: projectPath,
            stdio: 'inherit', // Show output to the user
            shell: true // Use shell for better cross-platform compatibility (e.g., finding npm on Windows)
        });

        return new Promise<void>((resolve, reject) => {
             npmInstall.on('close', (code) => {
                if (code === 0) {
                    console.log('Dependencies installed successfully.');
                    console.log(`
Project '${projectName}' created successfully at: ${projectPath}

To get started:
  cd ${projectName}
  positronic server`); // Suggest next step
                    resolve();
                } else {
                    console.error(`
npm install failed with code ${code}.`);
                    console.error('Please check the errors above and try running `npm install` manually.');
                    // Consider cleanup? fs.rm(projectPath, { recursive: true, force: true });
                    reject(new Error(`npm install failed with code ${code}`));
                    process.exit(1); // Exit process on failure
                }
            });

            npmInstall.on('error', (err) => {
                console.error(`
Failed to start npm install process: ${err}
Ensure Node.js and npm are correctly installed and in your PATH.`);
                // Consider cleanup? fs.rm(projectPath, { recursive: true, force: true });
                reject(err);
                process.exit(1); // Exit process on failure
            });
        });
    }
}