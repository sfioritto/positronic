import type { ArgumentsCamelCase } from 'yargs';


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


    }
}