import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import process from 'process';
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from '@jest/globals';
import { fileURLToPath } from 'url';
import type { ApiClient } from '../commands/helpers.js';
import { apiClient } from '../commands/helpers.js';

// Resolve paths relative to the workspace root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../../');
const cliExecutable = path.join(
  workspaceRoot,
  'packages/cli/dist/src/positronic.js'
);
const nodeExecutable = process.execPath;

// Mock server responses storage
let mockServerResources: Map<string, any> = new Map();

// Create a mock API client
const createMockApiClient = (): jest.MockedObject<ApiClient> => {
  return {
    fetch: jest.fn(async (apiPath: string, options?: any) => {
      if (apiPath === '/resources' && (!options || options.method === 'GET')) {
        // GET /resources - list resources
        const resources = Array.from(mockServerResources.values());
        return {
          ok: true,
          status: 200,
          json: async () => ({
            resources,
            truncated: false,
            count: resources.length,
          }),
        } as any;
      } else if (apiPath === '/resources' && options?.method === 'POST') {
        // POST /resources - upload resource
        const formData = options.body;
        // In real FormData, we'd parse this, but for testing we'll simulate
        // Since we can't easily parse FormData in tests, we'll just simulate success
        // and update our mock storage based on what we expect the sync to do
        return {
          ok: true,
          status: 201,
        } as any;
      }

      return {
        ok: false,
        status: 404,
        text: async () => 'Not found',
      } as any;
    }),
  };
};

describe('CLI Integration: positronic resources types', () => {
  let tempDir: string;
  const projectName = 'test-resource-types';
  let originalFetch: ApiClient['fetch'];
  let mockApiClient: jest.MockedObject<ApiClient>;

  beforeAll(() => {
    // Save the original fetch method
    originalFetch = apiClient.fetch;
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'positronic-resource-test-')
    );

    // Reset mock storage
    mockServerResources.clear();

    // Create and install mock API client
    mockApiClient = createMockApiClient();
    (apiClient as any).fetch = mockApiClient.fetch;
  });

  afterEach(() => {
    // Restore original fetch method
    (apiClient as any).fetch = originalFetch;

    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('should generate type definitions for resources', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);
    expect(fs.existsSync(projectPath)).toBe(true);

    // 2. Create resources directory and some test files
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(path.join(resourcesDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(resourcesDir, 'data'), { recursive: true });

    // Create test files
    fs.writeFileSync(path.join(resourcesDir, 'example.md'), '# Example');
    fs.writeFileSync(path.join(resourcesDir, 'test.txt'), 'Test content');
    fs.writeFileSync(path.join(resourcesDir, 'docs', 'readme.md'), '# Readme');
    fs.writeFileSync(path.join(resourcesDir, 'data', 'config.json'), '{}');
    // PNG magic bytes
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    fs.writeFileSync(path.join(resourcesDir, 'data', 'logo.png'), pngHeader);

    // File with spaces (should be excluded from dot notation)
    fs.writeFileSync(
      path.join(resourcesDir, 'file with spaces.txt'),
      'content'
    );

    // 3. Mock the server resources as if sync had happened
    mockServerResources.set('example.md', {
      key: 'example.md',
      type: 'text',
      size: 9,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('test.txt', {
      key: 'test.txt',
      type: 'text',
      size: 12,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('docs/readme.md', {
      key: 'docs/readme.md',
      type: 'text',
      size: 8,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('data/config.json', {
      key: 'data/config.json',
      type: 'text',
      size: 2,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('data/logo.png', {
      key: 'data/logo.png',
      type: 'binary',
      size: 8,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('file with spaces.txt', {
      key: 'file with spaces.txt',
      type: 'text',
      size: 7,
      lastModified: new Date().toISOString(),
    });

    // 4. Run the sync command (will use our mock)
    execSync(`${nodeExecutable} ${cliExecutable} resources sync`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 5. Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resources types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 6. Check if the types file was generated
    const typesPath = path.join(projectPath, 'resources.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    // 7. Read and verify the generated content
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Check the module declaration
    expect(content).toContain("declare module '@positronic/core'");

    // Check interface definitions
    expect(content).toContain('interface TextResource');
    expect(content).toContain('interface BinaryResource');
    expect(content).toContain('interface Resources');

    // Check method signatures
    expect(content).toContain('loadText(path: string): Promise<string>');
    expect(content).toContain('loadBinary(path: string): Promise<Buffer>');

    // Check generated resource properties
    expect(content).toContain('example: TextResource;');
    expect(content).toContain('test: TextResource;');
    expect(content).toContain('docs: {');
    expect(content).toContain('readme: TextResource;');
    expect(content).toContain('data: {');
    expect(content).toContain('config: TextResource;');
    expect(content).toContain('logo: BinaryResource;');

    // Should NOT contain files with invalid JS identifiers
    expect(content).not.toContain('file with spaces');

    // Check export statement
    expect(content).toContain('export {};');
  });

  it('should handle empty resources directory', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);

    // 2. Create empty resources directory (might not exist by default)
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // 3. Run the types command (no sync needed since no resources)
    execSync(`${nodeExecutable} ${cliExecutable} resources types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 4. Check if the types file was generated
    const typesPath = path.join(projectPath, 'resources.d.ts');
    expect(fs.existsSync(typesPath)).toBe(true);

    // 5. Read and verify the generated content
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Should still have the basic structure
    expect(content).toContain("declare module '@positronic/core'");
    expect(content).toContain('interface Resources');
    expect(content).toContain('loadText(path: string): Promise<string>');
    expect(content).toContain('loadBinary(path: string): Promise<Buffer>');
  });

  it('should handle resources with special characters', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);

    // 2. Create resources
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // Create files with special characters
    fs.writeFileSync(path.join(resourcesDir, 'valid_file.txt'), 'content');
    fs.writeFileSync(path.join(resourcesDir, '$special.txt'), 'content'); // Valid JS identifier
    fs.writeFileSync(path.join(resourcesDir, '_underscore.txt'), 'content'); // Valid JS identifier
    fs.writeFileSync(path.join(resourcesDir, '123invalid.txt'), 'content'); // Invalid - starts with number
    fs.writeFileSync(
      path.join(resourcesDir, 'special-chars!@#.txt'),
      'content'
    ); // Invalid

    // 3. Mock the server resources
    mockServerResources.set('valid_file.txt', {
      key: 'valid_file.txt',
      type: 'text',
      size: 7,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('$special.txt', {
      key: '$special.txt',
      type: 'text',
      size: 7,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('_underscore.txt', {
      key: '_underscore.txt',
      type: 'text',
      size: 7,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('123invalid.txt', {
      key: '123invalid.txt',
      type: 'text',
      size: 7,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('special-chars!@#.txt', {
      key: 'special-chars!@#.txt',
      type: 'text',
      size: 7,
      lastModified: new Date().toISOString(),
    });

    // 4. Run the sync command
    execSync(`${nodeExecutable} ${cliExecutable} resources sync`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 5. Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resources types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 6. Verify the generated content
    const typesPath = path.join(projectPath, 'resources.d.ts');
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Check valid identifiers are included
    expect(content).toContain('valid_file: TextResource;');
    expect(content).toContain('$special: TextResource;');
    expect(content).toContain('_underscore: TextResource;');

    // Check invalid identifiers are excluded
    expect(content).not.toContain('123invalid');
    expect(content).not.toContain('special-chars');
  });

  it('should correctly identify text vs binary files', async () => {
    // 1. Generate a project
    execSync(`${nodeExecutable} ${cliExecutable} new ${projectName}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });
    const projectPath = path.join(tempDir, projectName);

    // 2. Create resources
    const resourcesDir = path.join(projectPath, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // Create various file types
    fs.writeFileSync(path.join(resourcesDir, 'text.txt'), 'text');
    fs.writeFileSync(path.join(resourcesDir, 'script.js'), 'code');
    fs.writeFileSync(path.join(resourcesDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(resourcesDir, 'styles.css'), 'css');

    // Create actual binary content for binary files
    // JPEG magic bytes
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);
    fs.writeFileSync(path.join(resourcesDir, 'image.jpg'), jpegHeader);

    // Random binary data
    const binaryData = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
    ]);
    fs.writeFileSync(path.join(resourcesDir, 'binary.bin'), binaryData);

    // PDF magic bytes
    const pdfHeader = Buffer.from('%PDF-1.4\n%âÌÊÓ\n');
    fs.writeFileSync(path.join(resourcesDir, 'document.pdf'), pdfHeader);

    // 3. Mock the server resources
    mockServerResources.set('text.txt', {
      key: 'text.txt',
      type: 'text',
      size: 4,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('script.js', {
      key: 'script.js',
      type: 'text',
      size: 4,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('config.json', {
      key: 'config.json',
      type: 'text',
      size: 2,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('styles.css', {
      key: 'styles.css',
      type: 'text',
      size: 3,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('image.jpg', {
      key: 'image.jpg',
      type: 'binary',
      size: 10,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('binary.bin', {
      key: 'binary.bin',
      type: 'binary',
      size: 10,
      lastModified: new Date().toISOString(),
    });
    mockServerResources.set('document.pdf', {
      key: 'document.pdf',
      type: 'binary',
      size: 16,
      lastModified: new Date().toISOString(),
    });

    // 4. Run the sync command
    execSync(`${nodeExecutable} ${cliExecutable} resources sync`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 5. Run the types command
    execSync(`${nodeExecutable} ${cliExecutable} resources types`, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        POSITRONIC_LOCAL_PATH: workspaceRoot,
      },
    });

    // 6. Verify the generated content
    const typesPath = path.join(projectPath, 'resources.d.ts');
    const content = fs.readFileSync(typesPath, 'utf-8');

    // Check text resources
    expect(content).toContain('text: TextResource;');
    expect(content).toContain('script: TextResource;');
    expect(content).toContain('config: TextResource;');
    expect(content).toContain('styles: TextResource;');

    // Check binary resources
    expect(content).toContain('image: BinaryResource;');
    expect(content).toContain('binary: BinaryResource;');
    expect(content).toContain('document: BinaryResource;');
  });
});
