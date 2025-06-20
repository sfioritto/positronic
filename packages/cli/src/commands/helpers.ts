import fetch, { type RequestInit, type Response } from 'node-fetch';
import process from 'process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import caz from 'caz';
import { type ResourceEntry } from '@positronic/core';
import { isText } from 'istextorbinary';

// API Client interface for dependency injection
export interface ApiClient {
  fetch(path: string, options?: RequestInit): Promise<Response>;
}

// Singleton API client instance
export const apiClient: ApiClient = {
  fetch: async (apiPath: string, options?: RequestInit): Promise<Response> => {
    const port = process.env.POSITRONIC_SERVER_PORT || '8787';
    const baseUrl = `http://localhost:${port}`;
    const fullUrl = `${baseUrl}${
      apiPath.startsWith('/') ? apiPath : '/' + apiPath
    }`;

    const response = await fetch(fullUrl, options);
    return response;
  },
};
export async function generateProject(
  projectName: string,
  projectDir: string,
  onSuccess?: () => Promise<void> | void
) {
  const devPath = process.env.POSITRONIC_LOCAL_PATH;
  let newProjectTemplatePath = '@positronic/template-new-project';
  let cazOptions: {
    name: string;
    backend?: string;
    install?: boolean;
    pm?: string;
  } = { name: projectName };

  try {
    if (devPath) {
      // Copying templates, why you ask?
      // Well because when caz runs if you pass it a path to the template module
      // (e.g. for development environment setting POSITRONIC_LOCAL_PATH)
      // it runs npm install --production in the template directory. This is a problem
      // in our monorepo because this messes up the node_modules at the root of the
      // monorepo which then causes the tests to fail. Also ny time I was generating a new
      // project it was a pain to have to run npm install over and over again just
      // to get back to a good state.
      const originalNewProjectPkg = path.resolve(
        devPath,
        'packages',
        'template-new-project'
      );
      const copiedNewProjectPkg = fs.mkdtempSync(
        path.join(os.tmpdir(), 'positronic-newproj-')
      );
      fs.cpSync(originalNewProjectPkg, copiedNewProjectPkg, {
        recursive: true,
      });
      newProjectTemplatePath = copiedNewProjectPkg;
      cazOptions = {
        name: projectName,
        backend: 'cloudflare',
        install: true,
        pm: 'npm',
      };
    }

    await caz.default(newProjectTemplatePath, projectDir, {
      ...cazOptions,
      force: false,
    });

    await onSuccess?.();
  } finally {
    // Clean up the temporary copied new project package
    if (devPath) {
      fs.rmSync(newProjectTemplatePath, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    }
  }
}

export function scanLocalResources(resourcesDir: string): ResourceEntry[] {
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

        // Determine file type using istextorbinary
        // It checks both filename and content (first few bytes)
        const type: ResourceEntry['type'] = isText(
          entry.name,
          fs.readFileSync(fullPath)
        )
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
  return localResources;
}

// Extended ResourceEntry to add fields returned by the API
interface ApiResourceEntry extends ResourceEntry {
  size: number;
  lastModified: string;
}

interface ResourcesListResponse {
  resources: ApiResourceEntry[];
  truncated: boolean;
  count: number;
}

interface SyncResult {
  uploadCount: number;
  skipCount: number;
  errorCount: number;
  totalCount: number;
  errors: Array<{ file: string; message: string }>;
}

/**
 * Core resource sync logic without UI dependencies
 */
export async function syncResources(
  projectRootPath: string,
  client: ApiClient = apiClient
): Promise<SyncResult> {
  const resourcesDir = path.join(projectRootPath, 'resources');

  // Ensure resources directory exists
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  const localResources = scanLocalResources(resourcesDir);

  if (localResources.length === 0) {
    return {
      uploadCount: 0,
      skipCount: 0,
      errorCount: 0,
      totalCount: 0,
      errors: [],
    };
  }

  // Fetch server resources
  const response = await client.fetch('/resources');
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch resources: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as ResourcesListResponse;
  const serverResourceMap = new Map(data.resources.map((r) => [r.key, r]));

  let uploadCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const errors: Array<{ file: string; message: string }> = [];

  for (const resource of localResources) {
    const fileStats = fs.statSync(resource.path);
    const serverResource = serverResourceMap.get(resource.key);

    // Check if we need to upload (new or modified)
    let shouldUpload = !serverResource;

    if (serverResource && serverResource.size !== fileStats.size) {
      // Size mismatch indicates file has changed
      shouldUpload = true;
    } else if (serverResource) {
      // For same-size files, check modification time if available
      const localModTime = fileStats.mtime.toISOString();
      if (localModTime > serverResource.lastModified) {
        shouldUpload = true;
      }
    }

    if (shouldUpload) {
      try {
        const fileContent = fs.readFileSync(resource.path);
        const formData = new FormData();

        formData.append(
          'file',
          new Blob([fileContent]),
          path.basename(resource.path)
        );
        formData.append('type', resource.type);
        formData.append('path', resource.key);
        formData.append('key', resource.key);

        const uploadResponse = await client.fetch('/resources', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(
            `Upload failed: ${uploadResponse.status} ${errorText}`
          );
        }

        uploadCount++;
      } catch (error: any) {
        errorCount++;
        errors.push({
          file: resource.key,
          message: error.message || 'Unknown error',
        });
      }
    } else {
      skipCount++;
    }
  }

  return {
    uploadCount,
    skipCount,
    errorCount,
    totalCount: localResources.length,
    errors,
  };
}

/**
 * Check if a string is a valid JavaScript identifier
 */
function isValidJSIdentifier(name: string): boolean {
  // Must start with letter, underscore, or dollar sign
  // Can contain letters, digits, underscores, dollar signs
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

// TypeScript AST-like structures for cleaner generation
interface TypeProperty {
  name: string;
  type: string | TypeObject;
}

interface TypeObject {
  properties: TypeProperty[];
}

// Internal structure for building resource tree
interface ResourceNode {
  type?: 'text' | 'binary';
  fullName?: string; // Store the full filename for resources
  children?: Record<string, ResourceNode>;
}

/**
 * Build TypeScript structure from resource tree
 */
function buildTypeStructure(node: ResourceNode): TypeProperty[] {
  if (!node.children) return [];

  const properties: TypeProperty[] = [];
  const processedNames = new Set<string>();

  for (const [name, child] of Object.entries(node.children)) {
    if (processedNames.has(name)) continue;

    if (child.type) {
      // File resource
      const resourceType =
        child.type === 'text' ? 'TextResource' : 'BinaryResource';
      properties.push({ name, type: resourceType });
      processedNames.add(name);

      if (child.fullName) {
        processedNames.add(child.fullName);
      }
    } else if (child.children) {
      // Directory with nested resources
      const nestedProps = buildTypeStructure(child);
      if (nestedProps.length > 0) {
        properties.push({
          name,
          type: { properties: nestedProps },
        });
        processedNames.add(name);
      }
    }
  }

  return properties;
}

/**
 * Render TypeScript from structure
 */
function renderTypeScript(
  properties: TypeProperty[],
  indent: string = '    '
): string {
  return properties
    .map((prop) => {
      if (typeof prop.type === 'string') {
        return `${indent}${prop.name}: ${prop.type};`;
      } else {
        const nestedContent = renderTypeScript(
          prop.type.properties,
          indent + '  '
        );
        return `${indent}${prop.name}: {\n${nestedContent}\n${indent}};`;
      }
    })
    .join('\n');
}

/**
 * Generate TypeScript declarations for resources
 */
function generateResourceTypes(resources: ApiResourceEntry[]): string {
  const root: ResourceNode = { children: {} };

  // Build the tree structure
  for (const resource of resources) {
    const parts = resource.key.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;

      if (!current.children) {
        current.children = {};
      }

      if (isLeaf) {
        const resourceNode: ResourceNode = {
          type: resource.type,
          fullName: part,
        };

        if (isValidJSIdentifier(part)) {
          current.children[part] = resourceNode;
        }

        const withoutExt = part.replace(/\.[^/.]+$/, '');
        if (withoutExt !== part && isValidJSIdentifier(withoutExt)) {
          if (!current.children[withoutExt]) {
            current.children[withoutExt] = resourceNode;
          }
        }
      } else {
        if (isValidJSIdentifier(part)) {
          if (!current.children[part]) {
            current.children[part] = { children: {} };
          }
          current = current.children[part];
        } else {
          break;
        }
      }
    }
  }

  const typeStructure = buildTypeStructure(root);
  const interfaceContent = renderTypeScript(typeStructure);

  return `// Generated by Positronic CLI
// This file provides TypeScript types for your resources

declare module '@positronic/core' {
  interface TextResource {
    load(): Promise<string>;
    loadText(): Promise<string>;
    loadBinary(): never;
  }

  interface BinaryResource {
    load(): Promise<Buffer>;
    loadText(): never;
    loadBinary(): Promise<Buffer>;
  }

  interface Resources {
    // Method signatures for loading resources by path
    loadText(path: string): Promise<string>;
    loadBinary(path: string): Promise<Buffer>;

    // Resource properties accessible via dot notation
${interfaceContent}
  }
}

export {}; // Make this a module
`;
}

/**
 * Core type generation logic without UI dependencies
 */
export async function generateTypes(
  projectRootPath: string,
  client: ApiClient = apiClient
): Promise<string> {
  const typesFilePath = path.join(projectRootPath, 'resources.d.ts');

  // Fetch resources from the API
  const response = await client.fetch('/resources');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch resources: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as ResourcesListResponse;
  const typeDefinitions = generateResourceTypes(data.resources);

  fs.writeFileSync(typesFilePath, typeDefinitions, 'utf-8');

  return path.relative(process.cwd(), typesFilePath);
}
