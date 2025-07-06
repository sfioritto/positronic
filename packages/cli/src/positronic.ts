#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { buildCli } from './cli.js';
import { render } from 'ink';
import { createDevServer } from './commands/backend.js';

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

// Build and parse the CLI
const cli = buildCli({
  server,
  exitProcess: true,
  render,
});

// Parse the arguments
cli.parse();
