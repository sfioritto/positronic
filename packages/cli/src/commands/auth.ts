import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { AuthLogin } from '../components/auth-login.js';
import { AuthLogout } from '../components/auth-logout.js';
import { Whoami } from '../components/whoami.js';
import { ProjectConfigManager } from './project-config-manager.js';

interface LoginArgs {
  path?: string;
  project?: boolean;
}

interface LogoutArgs {
  project?: boolean;
}

export class AuthCommand {
  private configManager: ProjectConfigManager;
  private projectRootPath?: string;

  constructor(configManager?: ProjectConfigManager, projectRootPath?: string) {
    this.configManager = configManager || new ProjectConfigManager();
    this.projectRootPath = projectRootPath;
  }

  /**
   * Handles the 'px login' command.
   * Configure SSH key for authentication.
   */
  login({ path, project }: ArgumentsCamelCase<LoginArgs>): React.ReactElement {
    return React.createElement(AuthLogin, {
      configManager: this.configManager,
      keyPath: path,
      forProject: project || false,
      projectRootPath: this.projectRootPath,
    });
  }

  /**
   * Handles the 'px logout' command.
   * Clear SSH key configuration.
   */
  logout({ project }: ArgumentsCamelCase<LogoutArgs>): React.ReactElement {
    return React.createElement(AuthLogout, {
      configManager: this.configManager,
      forProject: project || false,
      projectRootPath: this.projectRootPath,
    });
  }

  /**
   * Handles the 'px whoami' command.
   * Shows the current authenticated identity.
   */
  whoami(): React.ReactElement {
    return React.createElement(Whoami, {
      configManager: this.configManager,
      projectRootPath: this.projectRootPath,
    });
  }
}
