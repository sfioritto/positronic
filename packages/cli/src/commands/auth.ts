import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { AuthStatus } from '../components/auth-status.js';
import { AuthLogin } from '../components/auth-login.js';
import { AuthLogout } from '../components/auth-logout.js';
import { AuthList } from '../components/auth-list.js';
import { AuthFormatJwkKey } from '../components/auth-format-jwk-key.js';
import { ProjectConfigManager } from './project-config-manager.js';

interface LoginArgs {
  path?: string;
  project?: boolean;
}

interface LogoutArgs {
  project?: boolean;
}

interface FormatJwkKeyArgs {
  pubkey?: string;
}

export class AuthCommand {
  private configManager: ProjectConfigManager;

  constructor(configManager?: ProjectConfigManager) {
    this.configManager = configManager || new ProjectConfigManager();
  }

  /**
   * Handles the 'px auth' or 'px auth status' command.
   * Shows current auth configuration.
   */
  status(): React.ReactElement {
    return React.createElement(AuthStatus, {
      configManager: this.configManager,
    });
  }

  /**
   * Handles the 'px auth login' command.
   * Configure SSH key for authentication.
   */
  login({ path, project }: ArgumentsCamelCase<LoginArgs>): React.ReactElement {
    return React.createElement(AuthLogin, {
      configManager: this.configManager,
      keyPath: path,
      forProject: project || false,
    });
  }

  /**
   * Handles the 'px auth logout' command.
   * Clear SSH key configuration.
   */
  logout({ project }: ArgumentsCamelCase<LogoutArgs>): React.ReactElement {
    return React.createElement(AuthLogout, {
      configManager: this.configManager,
      forProject: project || false,
    });
  }

  /**
   * Handles the 'px auth list' command.
   * List available SSH keys.
   */
  list(): React.ReactElement {
    return React.createElement(AuthList, {
      configManager: this.configManager,
    });
  }

  /**
   * Handles the 'px auth format-jwk-key' command.
   * Convert an SSH public key to JWK format for ROOT_PUBLIC_KEY configuration.
   */
  formatJwkKey({ pubkey }: ArgumentsCamelCase<FormatJwkKeyArgs>): React.ReactElement {
    return React.createElement(AuthFormatJwkKey, {
      pubkeyPath: pubkey,
    });
  }
}
