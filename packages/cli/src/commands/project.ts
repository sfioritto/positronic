import type { ArgumentsCamelCase } from 'yargs';
import caz from 'caz';
import path from 'path';


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
    add({ name, url }: ArgumentsCamelCase<AddProjectArgs>) {
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
    select({ name }: ArgumentsCamelCase<SelectProjectArgs>) {
        console.log('select', name);
    }

    /**
     * Handles the 'positronic project show' command.
     * Shows details of the active project (remote in Global Mode, local in Local Dev Mode).
     */
    show() {
        console.log('show');
    }

    /**
     * Handles the 'positronic new <project-name>' command.
     * Creates a new project directory structure and populates it with template files.
     * Also sets up the .positronic server environment.
     */
    async create({ name: projectName }: ArgumentsCamelCase<CreateProjectArgs>) {
        const projectDir = path.resolve(projectName);
        const positronicDir = path.join(projectDir, '.positronic');

        const devPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;
        let newProjectTemplate: string;
        let cloudflareTemplate: string;

        if (devPath) {
            console.log(`Using local development templates from: ${devPath}`);
            newProjectTemplate = path.resolve(devPath, 'packages', 'template-new-project');
            cloudflareTemplate = path.resolve(devPath, 'packages', 'template-cloudflare');
        } else {
            newProjectTemplate = '@positronic/template-new-project';
            cloudflareTemplate = '@positronic/template-cloudflare';
        }

        try {
            // 1. Scaffold the main project structure
            await caz.default(newProjectTemplate, projectName, {
                force: false,
            });

            // 2. Scaffold the .positronic directory for Cloudflare
            await caz.default(cloudflareTemplate, positronicDir, {
                force: false,
            });

            console.log(`
Next steps:`);
            console.log(`  cd ${projectName}`);
            console.log(`  (Review package.json and install dependencies if needed)`);
            console.log(`  positronic server (or just px s)  # To start the local dev server`);
            console.log(` Open a new terminal and run: `);
            console.log(`  px run example  # To run an example workflow`);
            console.log(`  px run example --watch  # To run an example workflow and watch for changes`);
        } catch (error) {
            console.error(`\nError creating project '${projectName}':`, error);
        }
    }
}