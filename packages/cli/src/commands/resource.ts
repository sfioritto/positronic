import React from 'react';
import { render } from 'ink';
import { scanLocalResources } from './helpers.js';
import * as fs from 'fs';
import * as path from 'path';
import { type ResourceEntry } from '@positronic/core';
import { ResourceList } from '../components/resource-list.js';
import { ResourceSync } from '../components/resource-sync.js';
import { ResourceDelete } from '../components/resource-delete.js';
import { ErrorComponent } from '../components/error.js';

// Extend ResourceEntry to add fields returned by the API
interface ApiResourceEntry extends ResourceEntry {
  size: number;
  lastModified: string;
}

interface ResourcesListResponse {
  resources: ApiResourceEntry[];
  truncated: boolean;
  count: number;
}

// Common text file extensions
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.css',
  '.scss',
  '.sass',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rs',
  '.go',
  '.swift',
  '.kt',
  '.scala',
  '.r',
  '.sql',
  '.graphql',
  '.vue',
  '.svelte',
  '.csv',
  '.log',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
  '.babelrc',
]);

export class ResourceCommand {
  constructor(
    private isLocalDevMode: boolean,
    private projectRootPath: string | null
  ) {}

  async list() {
    render(React.createElement(ResourceList));
  }

  async sync() {
    if (!this.isLocalDevMode || !this.projectRootPath) {
      render(
        React.createElement(ErrorComponent, {
          error: {
            title: 'Command Not Available',
            message:
              'sync command is only available in local development mode.',
            details: 'Navigate to your project directory to use this command.',
          },
        })
      );
      return;
    }

    // Check if resources directory exists, create if it doesn't
    const resourcesDir = path.join(this.projectRootPath, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir, { recursive: true });
    }
    const localResources = scanLocalResources(resourcesDir, TEXT_EXTENSIONS);

    render(
      React.createElement(ResourceSync, {
        localResources,
        resourcesDir,
        textExtensions: TEXT_EXTENSIONS,
      })
    );
  }

  async delete(resourcePath: string) {
    if (!resourcePath) {
      render(
        React.createElement(ErrorComponent, {
          error: {
            title: 'Missing Resource Path',
            message: 'Please provide a resource path to delete.',
            details: 'Usage: positronic resource delete <path>',
          },
        })
      );
      return;
    }

    // The resourcePath should be relative to the resources directory
    // If the user provides "subfolder/file.txt", the key is "resources/subfolder/file.txt"
    const resourceKey = resourcePath.startsWith('resources/')
      ? resourcePath
      : `resources/${resourcePath}`;

    render(
      React.createElement(ResourceDelete, {
        resourceKey,
        resourcePath,
      })
    );
  }

  async clear() {
    if (!this.isLocalDevMode) {
      render(
        React.createElement(ErrorComponent, {
          error: {
            title: 'Command Not Available',
            message:
              'clear command is only available in local development mode.',
            details:
              'This command deletes all resources and should only be used during development.',
          },
        })
      );
      return;
    }

    // Import and render ResourceClear component (to be created)
    const { ResourceClear } = await import('../components/resource-clear.js');
    render(React.createElement(ResourceClear));
  }
}
