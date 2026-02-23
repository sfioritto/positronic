#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { buildCli } from './cli.js';
import { render } from 'ink';
import { createDevServer } from './commands/backend.js';
import { configureApiClient } from './commands/helpers.js';
import { ProjectConfigManager } from './commands/project-config-manager.js';
import { setAuthProjectRootPath } from './lib/jwt-auth.js';

function findProjectRootSync(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  while (true) {
    const configPath = path.join(currentDir, 'positronic.config.json');
    try {
      fs.accessSync(configPath);
      return currentDir;
    } catch (e) {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        return null;
      }
      currentDir = parentDir;
    }
  }
}

// Determine mode and project path once at the start
const projectRootPath = findProjectRootSync(process.cwd());
const server = projectRootPath
  ? await createDevServer(projectRootPath)
  : undefined;

// Configure API client based on mode
if (projectRootPath) {
  // Local Dev Mode: connect to localhost
  const port = process.env.POSITRONIC_PORT || '8787';
  configureApiClient(`http://localhost:${port}`, true);
} else {
  // Global Mode: connect to the selected project's URL
  const configManager = new ProjectConfigManager();
  const currentProject = configManager.getCurrentProject();

  if (currentProject) {
    configureApiClient(currentProject.url, false);
  }
  // If no project is selected, leave apiClient unconfigured
  // Commands will show appropriate errors when they try to connect
}

// Set the project root path for local auth resolution
setAuthProjectRootPath(projectRootPath);

// Build and parse the CLI
const cli = buildCli({
  server,
  exitProcess: true,
  render,
  projectRootPath: projectRootPath || undefined,
});

// Parse the arguments
cli.parse();
