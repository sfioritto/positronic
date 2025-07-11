import React, { ReactElement } from 'react';
import { scanLocalResources, generateTypes } from './helpers.js';
import * as fs from 'fs';
import * as path from 'path';
import { ResourceList } from '../components/resource-list.js';
import { ResourceSync } from '../components/resource-sync.js';
import { ResourceClear } from '../components/resource-clear.js';
import { ResourceDelete } from '../components/resource-delete.js';
import { ResourceUpload } from '../components/resource-upload.js';
import { ResourceTypes } from '../components/resource-types.js';
import { ErrorComponent } from '../components/error.js';
import type { PositronicDevServer } from '@positronic/spec';

export class ResourcesCommand {
  constructor(private server?: PositronicDevServer) {}

  list(): ReactElement {
    return React.createElement(ResourceList);
  }

  sync(): ReactElement {
    if (!this.server) {
      return React.createElement(ErrorComponent, {
        error: {
          title: 'Command Not Available',
          message: 'This command is only available in local dev mode',
          details:
            'Please run this command from within a Positronic project directory.',
        },
      });
    }

    // Check if resources directory exists, create if it doesn't
    const resourcesDir = path.join(this.server.projectRootDir, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir, { recursive: true });
    }
    const localResources = scanLocalResources(resourcesDir);

    return React.createElement(ResourceSync, {
      localResources,
      resourcesDir,
    });
  }

  types(): ReactElement {
    if (!this.server) {
      return React.createElement(ErrorComponent, {
        error: {
          title: 'Command Not Available',
          message: 'This command is only available in local dev mode',
          details:
            'Please run this command from within a Positronic project directory.',
        },
      });
    }

    return React.createElement(ResourceTypes, {
      projectRootDir: this.server.projectRootDir,
    });
  }

  delete(resourcePath: string): ReactElement {
    if (!resourcePath) {
      return React.createElement(ErrorComponent, {
        error: {
          title: 'Missing Resource Path',
          message: 'Please provide a resource path to delete.',
          details: 'Usage: positronic resources delete <path>',
        },
      });
    }

    // The resourcePath should be relative to the resources directory
    const resourceKey = resourcePath;

    return React.createElement(ResourceDelete, {
      resourceKey,
      resourcePath,
      projectRootPath: this.server?.projectRootDir,
    });
  }

  async clear() {
    // Import and render ResourceClear component
    return React.createElement(ResourceClear);
  }

  upload(filePath: string, customKey?: string): ReactElement {
    return React.createElement(ResourceUpload, {
      filePath,
      customKey,
      projectRootPath: this.server?.projectRootDir,
    });
  }
}
