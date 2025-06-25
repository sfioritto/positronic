import React from 'react';
import { render } from 'ink';
import { scanLocalResources, generateTypes } from './helpers.js';
import * as fs from 'fs';
import * as path from 'path';
import { ResourceList } from '../components/resource-list.js';
import { ResourceSync } from '../components/resource-sync.js';
import { ResourceDelete } from '../components/resource-delete.js';
import { ResourceUpload } from '../components/resource-upload.js';
import { ErrorComponent } from '../components/error.js';

export class ResourcesCommand {
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
    const localResources = scanLocalResources(resourcesDir);

    render(
      React.createElement(ResourceSync, {
        localResources,
        resourcesDir,
      })
    );
  }

  async types() {
    if (!this.isLocalDevMode || !this.projectRootPath) {
      render(
        React.createElement(ErrorComponent, {
          error: {
            title: 'Command Not Available',
            message:
              'types command is only available in local development mode.',
            details: 'Navigate to your project directory to use this command.',
          },
        })
      );
      return;
    }

    try {
      const typesFilePath = await generateTypes(this.projectRootPath);
      console.log(`✅ Generated resource types at ${typesFilePath}`);
    } catch (error) {
      render(
        React.createElement(ErrorComponent, {
          error: {
            title: 'Type Generation Failed',
            message: 'Failed to generate resource types.',
            details: error instanceof Error ? error.message : String(error),
          },
        })
      );
    }
  }

  async delete(resourcePath: string) {
    if (!resourcePath) {
      render(
        React.createElement(ErrorComponent, {
          error: {
            title: 'Missing Resource Path',
            message: 'Please provide a resource path to delete.',
            details: 'Usage: positronic resources delete <path>',
          },
        })
      );
      return;
    }

    // The resourcePath should be relative to the resources directory
    const resourceKey = resourcePath;

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

  async upload(filePath: string, customKey?: string) {
    render(
      React.createElement(ResourceUpload, {
        filePath,
        customKey,
      })
    );
  }
}
