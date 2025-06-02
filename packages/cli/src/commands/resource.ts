import type { ArgumentsCamelCase } from 'yargs';
import { apiFetch } from './helpers.js';
import * as fs from 'fs';
import * as path from 'path';
import { type ResourceEntry } from '@positronic/core';

interface ResourceListArgs {}
interface ResourceSyncArgs {}

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

  async list(argv: ArgumentsCamelCase<ResourceListArgs>) {
    try {
      const response = await apiFetch('/resources', {
        method: 'GET',
      });

      if (response.status === 200) {
        const result = (await response.json()) as ResourcesListResponse;

        if (result.count === 0) {
          console.log('No resources found in the project.');
          return;
        }

        console.log(
          `\nFound ${result.count} resource${result.count === 1 ? '' : 's'}:\n`
        );

        // Group resources by type
        const textResources = result.resources.filter((r) => r.type === 'text');
        const binaryResources = result.resources.filter(
          (r) => r.type === 'binary'
        );

        if (textResources.length > 0) {
          console.log('📄 Text Resources:');
          textResources.forEach((resource) => {
            console.log(
              `  - ${resource.key} (${this.formatSize(resource.size)})`
            );
          });
          console.log('');
        }

        if (binaryResources.length > 0) {
          console.log('📦 Binary Resources:');
          binaryResources.forEach((resource) => {
            console.log(
              `  - ${resource.key} (${this.formatSize(resource.size)})`
            );
          });
          console.log('');
        }

        if (result.truncated) {
          console.log(
            '⚠️  Results truncated. More resources exist than shown.'
          );
        }
      } else {
        const errorText = await response.text();
        console.error(
          `Error fetching resources: ${response.status} ${response.statusText}`
        );
        console.error(`Server response: ${errorText}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`Error connecting to the local development server.`);
      console.error(
        "Please ensure the server is running ('positronic server' or 'px s')."
      );
      if (error.code === 'ECONNREFUSED') {
        console.error(
          'Reason: Connection refused. The server might not be running or is listening on a different port.'
        );
      } else {
        console.error(`Fetch error details: ${error.message}`);
      }
      process.exit(1);
    }
  }

  async sync(argv: ArgumentsCamelCase<ResourceSyncArgs>) {
    if (!this.isLocalDevMode || !this.projectRootPath) {
      console.error(
        'Error: sync command is only available in local development mode.'
      );
      console.error('Navigate to your project directory to use this command.');
      process.exit(1);
    }

    try {
      // Step 1: Get list of resources from server
      console.log('Fetching existing resources from server...');
      const response = await apiFetch('/resources', {
        method: 'GET',
      });

      if (response.status !== 200) {
        const errorText = await response.text();
        console.error(
          `Error fetching resources: ${response.status} ${response.statusText}`
        );
        console.error(`Server response: ${errorText}`);
        process.exit(1);
      }

      const serverResources = (await response.json()) as ResourcesListResponse;
      const serverResourceMap = new Map(
        serverResources.resources.map((r) => [r.key, r])
      );

      // Step 2: Scan local resources directory
      const resourcesDir = path.join(this.projectRootPath, 'resources');

      if (!fs.existsSync(resourcesDir)) {
        console.log('No resources directory found. Creating one...');
        fs.mkdirSync(resourcesDir, { recursive: true });
        console.log('Resources directory created at:', resourcesDir);
        return;
      }

      // Step 3: Collect all local resources by scanning the directory
      const localResources: ResourceEntry[] = [];

      const scanDirectory = (dir: string, baseDir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            scanDirectory(fullPath, baseDir);
          } else if (entry.isFile()) {
            // Calculate relative path from resources directory
            const relativePath = path.relative(baseDir, fullPath);
            // Use forward slashes for consistency across platforms
            const key = relativePath.replace(/\\/g, '/');

            // Determine file type based on extension
            const ext = path.extname(entry.name).toLowerCase();
            const type: ResourceEntry['type'] = TEXT_EXTENSIONS.has(ext)
              ? 'text'
              : 'binary';

            localResources.push({
              key,
              path: fullPath,
              type,
            });
          }
        }
      };

      scanDirectory(resourcesDir, resourcesDir);

      if (localResources.length === 0) {
        console.log('No files found in the resources directory.');
        return;
      }

      // Step 4: Compare and sync
      console.log(
        `\nFound ${localResources.length} local file${
          localResources.length === 1 ? '' : 's'
        } in resources directory.`
      );

      let uploadCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      for (const resource of localResources) {
        const stats = fs.statSync(resource.path);
        const serverResource = serverResourceMap.get(resource.key);

        // Check if we need to upload (new or modified)
        let shouldUpload = !serverResource;

        if (serverResource && serverResource.size !== stats.size) {
          // Size mismatch indicates file has changed
          shouldUpload = true;
        } else if (serverResource) {
          // For same-size files, check modification time if available
          const localModTime = stats.mtime.toISOString();
          if (localModTime > serverResource.lastModified) {
            shouldUpload = true;
          }
        }

        if (shouldUpload) {
          try {
            console.log(`⬆️  Uploading ${resource.key}...`);

            const fileContent = fs.readFileSync(resource.path);
            const formData = new FormData();

            formData.append(
              'file',
              new Blob([fileContent]),
              path.basename(resource.path)
            );
            formData.append('type', resource.type);
            formData.append('path', `resources/${resource.key}`);
            formData.append('key', resource.key);

            const uploadResponse = await apiFetch('/resources', {
              method: 'POST',
              body: formData,
            });

            if (uploadResponse.status === 201) {
              console.log(`✅ ${resource.key} uploaded successfully`);
              uploadCount++;
            } else {
              const errorText = await uploadResponse.text();
              console.error(`❌ ${resource.key} - Upload failed: ${errorText}`);
              errorCount++;
            }
          } catch (error: any) {
            console.error(
              `❌ ${resource.key} - Upload error: ${error.message}`
            );
            errorCount++;
          }
        } else {
          console.log(`⏭️  ${resource.key} is up to date`);
          skipCount++;
        }
      }

      // Summary
      console.log('\n📊 Sync Summary:');
      console.log(`  • Uploaded: ${uploadCount}`);
      console.log(`  • Skipped (up to date): ${skipCount}`);
      if (errorCount > 0) {
        console.log(`  • Errors: ${errorCount}`);
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error during sync: ${error.message}`);
      process.exit(1);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}
