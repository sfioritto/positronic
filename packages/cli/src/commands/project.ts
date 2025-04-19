import * as fs from 'fs';
import * as path from 'path';
// Import Node.js built-in for running commands
import { execSync } from 'child_process';
// Import templates

// TODO: Consider passing config/mode info via constructor instead of relying on process.env here
const isLocalDevMode = !!process.env.POSITRONIC_PROJECT_PATH;
const localProjectPath = process.env.POSITRONIC_PROJECT_PATH;

export class ProjectCommand {
    // Constructor could accept shared config, API clients, etc. later
    constructor() {}

    /**
     * Handles the 'positronic project add <name> --url <url>' command.
     * Adds a project configuration to the global store.
     * Only available in Global Mode.
     */
    add(argv: any): void {
        console.log(`Adding project ${argv.name} with URL: ${argv.url}`);
        if (isLocalDevMode) {
            // This check is technically redundant due to yargs structure, but good defense
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
        if (isLocalDevMode) {
            console.log(`Operating in Local Development Mode.`);
            console.log(`Current project path: ${localProjectPath}`);
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
         // This handler only runs in Global Mode (enforced by yargs structure)
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
        if (isLocalDevMode) {
            console.log(`Operating in Local Development Mode.`);
            console.log(`Current project path: ${localProjectPath}`);
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
    create(argv: any): void {
        console.log('(Placeholder: Create function not implemented yet)');
    }
}