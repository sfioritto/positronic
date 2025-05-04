import type { ArgumentsCamelCase } from 'yargs';
import caz from 'caz';
import path from 'path';
import fs from 'fs';
import os from 'os';


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
    async create({ name: projectPathArg }: ArgumentsCamelCase<CreateProjectArgs>) {
        const projectDir = path.resolve(projectPathArg);
        const projectName = path.basename(projectDir);
        const positronicDir = path.join(projectDir, '.positronic');

        const devPath = process.env.POSITRONIC_PACKAGES_DEV_PATH;
        const isTestMode = process.env.NODE_ENV === 'test';

        let newProjectTemplatePath = '@positronic/template-new-project';
        let cloudflareTemplatePath = '@positronic/template-cloudflare';
        if (devPath) {
            const originalNewProjectPath = path.resolve(devPath, 'packages', 'template-new-project');
            const originalCloudflarePath = path.resolve(devPath, 'packages', 'template-cloudflare');

            // Copying templates, why you ask?
            // Well because when caz runs if you pass it a path to the template module
            // it runs npm install --production in the template directory. This is a problem
            // in our monorepo because this messes up the node_modules at the root of the
            // monorepo which then causes the tests to fail. Also ny time I was generating a new
            // project it was a pain to have to run npm install over and over again just
            // to get back to a good state.
            const tempNewProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-newproj-'));
            const tempCloudflareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-cf-'));

            fs.cpSync(originalNewProjectPath, tempNewProjectDir, { recursive: true });
            fs.cpSync(originalCloudflarePath, tempCloudflareDir, { recursive: true });

            newProjectTemplatePath = tempNewProjectDir;
            cloudflareTemplatePath = tempCloudflareDir;
        }

        let cazOptions;
        if (isTestMode) {
            cazOptions = { name: projectName, install: true, pm: 'npm' };
        } else {
            cazOptions = { name: projectName };
        }

        // 1. Scaffold the main project structure
        await caz.default(newProjectTemplatePath, projectDir, {
            ...cazOptions,
            force: false,
        });

        // 2. Scaffold the .positronic directory for Cloudflare
        await caz.default(cloudflareTemplatePath, positronicDir, {
            ...cazOptions, // cazOptions already contains { name: projectName }
            force: false,
        });

        console.log(`\nProject '${projectName}' created successfully at ${projectDir}.`);
        console.log(`\nNext steps:`);
        console.log(`\ncd ${projectDir}`);
        console.log(`\nInstall dependencies if needed (using npm/yarn/pnpm/etc)`);
        console.log(`\npositronic server (or just px s)`);
        console.log(`\nOpen a new terminal in '${projectName}' and run: `);
        console.log(`\npx run example --watch`);
    }
}