import type { ArgumentsCamelCase } from 'yargs';
import { generateProject } from './helpers.js';
import path from 'path';
import React from 'react';
import { ProjectAdd } from '../components/project-add.js';
import { ProjectList } from '../components/project-list.js';
import { ProjectSelect } from '../components/project-select.js';
import { ProjectShow } from '../components/project-show.js';

// Re-export types from project-config-manager for backward compatibility
export type { Project, ProjectConfig } from './project-config-manager.js';
// Import and re-export the class
import { ProjectConfigManager } from './project-config-manager.js';
export { ProjectConfigManager };

// Original ProjectCommand arguments
interface AddProjectArgs {
  name: string;
  url: string;
}

interface SelectProjectArgs {
  name?: string; // Optional because it can be interactive
}

interface CreateProjectArgs {
  name: string;
}

export class ProjectCommand {
  private projectConfig: ProjectConfigManager;

  constructor() {
    // Instantiate ProjectConfigManager with default home directory
    this.projectConfig = new ProjectConfigManager();
  }

  /**
   * Handles the 'positronic project add <name> --url <url>' command.
   * Adds a project configuration to the global store.
   */
  add({ name, url }: ArgumentsCamelCase<AddProjectArgs>): React.ReactElement {
    return React.createElement(ProjectAdd, {
      name,
      url,
      projectConfig: this.projectConfig,
    });
  }

  /**
   * Handles the 'positronic project list' command.
   * Lists configured remote projects (Global Mode) or shows current local project path (Local Dev Mode).
   */
  list(): React.ReactElement {
    return React.createElement(ProjectList, {
      projectConfig: this.projectConfig,
    });
  }

  /**
   * Handles the 'positronic project select [name]' command.
   * Selects the active remote project for subsequent commands.
   * Only available in Global Mode.
   */
  select({ name }: ArgumentsCamelCase<SelectProjectArgs>): React.ReactElement {
    return React.createElement(ProjectSelect, {
      name,
      projectConfig: this.projectConfig,
    });
  }

  /**
   * Handles the 'positronic project show' command.
   * Shows details of the active project (remote in Global Mode, local in Local Dev Mode).
   */
  show(): React.ReactElement {
    return React.createElement(ProjectShow, {
      projectConfig: this.projectConfig,
    });
  }

  /**
   * Handles the 'positronic new <project-name>' command.
   * Creates a new project directory structure and populates it with template files.
   * Also sets up the .positronic server environment.
   */
  async create({
    name: projectPathArg,
  }: ArgumentsCamelCase<CreateProjectArgs>) {
    const projectDir = path.resolve(projectPathArg);
    const projectName = path.basename(projectDir);
    await generateProject(projectName, projectDir);
    console.log(
      `\nProject '${projectName}' created successfully at ${projectDir}.`
    );
    console.log(`\nNext steps:`);
    console.log(`\ncd ${projectDir}`);
    console.log(
      `\nInstall dependencies if you didn't choose to during setup (e.g., npm install)`
    );
    console.log(`\nRun the development server: px s or positronic server`);
    console.log(
      `\nOpen a new terminal in '${projectName}' and run a brain: px run example --watch`
    );
  }
}
