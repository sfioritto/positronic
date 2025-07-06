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
import type { PositronicDevServer } from '@positronic/spec';

export class ResourcesCommand {
  constructor(private server?: PositronicDevServer) {}

  async list() {
    render(React.createElement(ResourceList));
  }

  async sync() {
    if (!this.server) {
      throw new Error('This command is only available in local dev mode');
    }
    // Check if resources directory exists, create if it doesn't
    const resourcesDir = path.join(this.server.projectRootDir, 'resources');
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
    try {
      if (!this.server) {
        throw new Error('This command is only available in local dev mode');
      }
      const typesFilePath = await generateTypes(this.server.projectRootDir);
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
        projectRootPath: this.server?.projectRootDir,
      })
    );
  }

  async clear() {
    // Import and render ResourceClear component (to be created)
    const { ResourceClear } = await import('../components/resource-clear.js');
    render(React.createElement(ResourceClear));
  }

  async upload(filePath: string, customKey?: string) {
    render(
      React.createElement(ResourceUpload, {
        filePath,
        customKey,
        projectRootPath: this.server?.projectRootDir,
      })
    );
  }
}
