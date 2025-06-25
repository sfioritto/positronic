import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Response } from 'node-fetch';
import { syncResources, generateTypes } from './helpers.js';
import { createMockApiClient } from '../test/mock-api-client.js';

describe('Helper Functions Unit Tests', () => {
  let tempDir: string;
  let projectPath: string;
  let mockClient: ReturnType<typeof createMockApiClient>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positronic-unit-test-'));
    projectPath = path.join(tempDir, 'test-project');
    fs.mkdirSync(projectPath, { recursive: true });
    mockClient = createMockApiClient();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    mockClient.reset();
  });

  describe('syncResources', () => {
    it('should create resources directory if it does not exist', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      expect(fs.existsSync(resourcesDir)).toBe(false);

      await syncResources(projectPath, mockClient);

      expect(fs.existsSync(resourcesDir)).toBe(true);
    });

    it('should return zero counts for empty resources directory', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      const result = await syncResources(projectPath, mockClient);

      expect(result).toEqual({
        uploadCount: 0,
        skipCount: 0,
        errorCount: 0,
        totalCount: 0,
        deleteCount: 0,
        errors: [],
      });

      // Should not make any API calls for empty directory
      expect(mockClient.calls.length).toBe(1); // Only GET /resources call
    });

    it('should upload new resources', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create test files
      fs.writeFileSync(path.join(resourcesDir, 'test.txt'), 'Hello World');
      fs.writeFileSync(
        path.join(resourcesDir, 'data.json'),
        '{"key": "value"}'
      );

      const result = await syncResources(projectPath, mockClient);

      expect(result.uploadCount).toBe(2);
      expect(result.skipCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.totalCount).toBe(2);

      // Verify API calls
      expect(mockClient.calls).toHaveLength(3); // 1 GET + 2 POSTs
      expect(mockClient.calls[0].path).toBe('/resources');
      expect(mockClient.calls[1].path).toBe('/resources');
      expect(mockClient.calls[1].options.method).toBe('POST');

      // Verify uploaded resources
      const resources = mockClient.getResources();
      expect(resources).toHaveLength(2);
      expect(resources.find((r) => r.key === 'test.txt')).toBeDefined();
      expect(resources.find((r) => r.key === 'data.json')).toBeDefined();
    });

    it('should skip unchanged resources', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Add existing resource to mock with future lastModified to ensure it's newer than the file
      mockClient.addResource({
        key: 'existing.txt',
        type: 'text',
        size: 8,
        lastModified: new Date(Date.now() + 10000).toISOString(), // 10 seconds in the future
        local: false, // Default to false for existing tests
      });

      // Create matching file
      fs.writeFileSync(path.join(resourcesDir, 'existing.txt'), '12345678'); // 8 bytes

      const result = await syncResources(projectPath, mockClient);

      expect(result.uploadCount).toBe(0);
      expect(result.skipCount).toBe(1);
      expect(result.errorCount).toBe(0);

      // Should only make GET call
      expect(mockClient.calls).toHaveLength(1);
      expect(mockClient.calls[0].path).toBe('/resources');
    });

    it('should upload modified resources based on size', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Add existing resource to mock with different size
      mockClient.addResource({
        key: 'modified.txt',
        type: 'text',
        size: 5,
        lastModified: new Date(Date.now() - 10000).toISOString(),
        local: false, // Default to false for existing tests
      });

      // Create file with different content
      fs.writeFileSync(path.join(resourcesDir, 'modified.txt'), 'New content');

      const result = await syncResources(projectPath, mockClient);

      expect(result.uploadCount).toBe(1);
      expect(result.skipCount).toBe(0);
    });

    it('should upload resources based on modification time when size matches', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Add existing resource to mock with same size but older timestamp
      mockClient.addResource({
        key: 'updated.txt',
        type: 'text',
        size: 11, // Same size as "Same content"
        lastModified: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago
        local: false, // Default to false for existing tests
      });

      // Create file with same size but it will have a newer modification time
      fs.writeFileSync(path.join(resourcesDir, 'updated.txt'), 'Same content'); // 11 bytes

      const result = await syncResources(projectPath, mockClient);

      expect(result.uploadCount).toBe(1);
      expect(result.skipCount).toBe(0);
    });

    it('should handle nested directories', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      const docsDir = path.join(resourcesDir, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });

      fs.writeFileSync(path.join(docsDir, 'readme.md'), '# README');

      const result = await syncResources(projectPath, mockClient);

      expect(result.uploadCount).toBe(1);

      const resources = mockClient.getResources();
      expect(resources[0].key).toBe('docs/readme.md');
    });

    it('should handle upload errors gracefully', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create a file that will trigger an error in our mock
      // We'll modify the mock to fail on specific file names
      const badClient = createMockApiClient();
      const originalFetch = badClient.fetch;
      badClient.fetch = async (path, options) => {
        if (
          options?.method === 'POST' &&
          options.body?.get('key') === 'error.txt'
        ) {
          throw new Error('Upload failed');
        }
        return originalFetch.call(badClient, path, options);
      };

      fs.writeFileSync(path.join(resourcesDir, 'error.txt'), 'This will fail');
      fs.writeFileSync(
        path.join(resourcesDir, 'good.txt'),
        'This will succeed'
      );

      const result = await syncResources(projectPath, badClient);

      expect(result.uploadCount).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        file: 'error.txt',
        message: 'Upload failed',
      });
    });

    it('should delete server resources with local=true when files are removed', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create the file that should still exist first
      fs.writeFileSync(
        path.join(resourcesDir, 'still-exists.txt'),
        'I still exist'
      );

      // Add existing resources to mock - some synced (local=true), some manual (local=false)
      mockClient.addResource({
        key: 'deleted-file.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: true, // This one should be deleted
      });
      mockClient.addResource({
        key: 'still-exists.txt',
        type: 'text',
        size: 13, // Exact size of "I still exist"
        lastModified: new Date(Date.now() + 10000).toISOString(), // Future timestamp to prevent re-upload
        local: true, // This one should NOT be deleted
      });
      mockClient.addResource({
        key: 'docs/removed-doc.md',
        type: 'text',
        size: 200,
        lastModified: new Date().toISOString(),
        local: true, // This one should be deleted
      });

      const result = await syncResources(projectPath, mockClient);

      expect(result.deleteCount).toBe(2);
      expect(result.uploadCount).toBe(0); // No new uploads
      expect(result.skipCount).toBe(1); // still-exists.txt is up to date

      // Verify the correct resources were deleted
      const remainingResources = mockClient.getResources();
      expect(remainingResources).toHaveLength(1);
      expect(remainingResources[0].key).toBe('still-exists.txt');

      // Verify DELETE API calls were made
      const deleteCalls = mockClient.calls.filter(
        (call) => call.options?.method === 'DELETE'
      );
      expect(deleteCalls).toHaveLength(2);
      expect(deleteCalls[0].path).toBe('/resources/deleted-file.txt');
      expect(deleteCalls[1].path).toBe('/resources/docs%2Fremoved-doc.md'); // URL encoded
    });

    it('should preserve manually uploaded resources (local=false)', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Add existing resources to mock
      mockClient.addResource({
        key: 'manual-upload.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: false, // Manually uploaded - should NOT be deleted
      });
      mockClient.addResource({
        key: 'another-manual.png',
        type: 'binary',
        size: 5000,
        lastModified: new Date().toISOString(),
        local: false, // Manually uploaded - should NOT be deleted
      });
      mockClient.addResource({
        key: 'synced-file.txt',
        type: 'text',
        size: 75,
        lastModified: new Date().toISOString(),
        local: true, // Synced file that was deleted locally
      });

      // Don't create any local files - all are "deleted" locally

      const result = await syncResources(projectPath, mockClient);

      expect(result.deleteCount).toBe(1); // Only the synced file
      expect(result.uploadCount).toBe(0);
      expect(result.skipCount).toBe(0);

      // Verify manual uploads are still there
      const remainingResources = mockClient.getResources();
      expect(remainingResources).toHaveLength(2);
      expect(
        remainingResources.find((r) => r.key === 'manual-upload.txt')
      ).toBeDefined();
      expect(
        remainingResources.find((r) => r.key === 'another-manual.png')
      ).toBeDefined();
      expect(
        remainingResources.find((r) => r.key === 'synced-file.txt')
      ).toBeUndefined();

      // Verify only one DELETE call was made
      const deleteCalls = mockClient.calls.filter(
        (call) => call.options?.method === 'DELETE'
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].path).toBe('/resources/synced-file.txt');
    });

    it('should handle delete errors gracefully', async () => {
      const resourcesDir = path.join(projectPath, 'resources');
      fs.mkdirSync(resourcesDir, { recursive: true });

      // Create a client that fails on DELETE requests
      const badClient = createMockApiClient();
      badClient.addResource({
        key: 'will-fail-delete.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: true,
      });

      const originalFetch = badClient.fetch;
      badClient.fetch = async (path, options) => {
        if (options?.method === 'DELETE') {
          return new Response('Internal Server Error', { status: 500 });
        }
        return originalFetch.call(badClient, path, options);
      };

      // Don't create the file locally so it should be deleted

      const result = await syncResources(projectPath, badClient);

      expect(result.deleteCount).toBe(0); // Failed to delete
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        file: 'will-fail-delete.txt',
        message: 'Failed to delete: Delete failed: 500 Internal Server Error',
      });
    });
  });

  describe('generateTypes', () => {
    it('should generate types file for empty resources', async () => {
      const result = await generateTypes(projectPath, mockClient);

      const typesPath = path.join(projectPath, 'resources.d.ts');
      expect(fs.existsSync(typesPath)).toBe(true);

      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain("declare module '@positronic/core'");
      expect(content).toContain('interface Resources');
      expect(content).toContain('loadText(path: string): Promise<string>');
      expect(content).toContain('loadBinary(path: string): Promise<Buffer>');
    });

    it('should generate types for text and binary resources', async () => {
      // Add mock resources
      mockClient.addResource({
        key: 'readme.md',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });
      mockClient.addResource({
        key: 'logo.png',
        type: 'binary',
        size: 1000,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });
      mockClient.addResource({
        key: 'data.json',
        type: 'text',
        size: 50,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });

      await generateTypes(projectPath, mockClient);

      const typesPath = path.join(projectPath, 'resources.d.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');

      // Check resource declarations
      expect(content).toContain('readme: TextResource;');
      expect(content).toContain('logo: BinaryResource;');
      expect(content).toContain('data: TextResource;');
    });

    it('should handle nested resources', async () => {
      mockClient.addResource({
        key: 'docs/api.md',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });
      mockClient.addResource({
        key: 'docs/images/diagram.png',
        type: 'binary',
        size: 500,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });
      mockClient.addResource({
        key: 'config/settings.json',
        type: 'text',
        size: 200,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });

      await generateTypes(projectPath, mockClient);

      const typesPath = path.join(projectPath, 'resources.d.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');

      // Check nested structure
      expect(content).toContain('docs: {');
      expect(content).toContain('api: TextResource;');
      expect(content).toContain('images: {');
      expect(content).toContain('diagram: BinaryResource;');
      expect(content).toContain('config: {');
      expect(content).toContain('settings: TextResource;');
    });

    it('should exclude invalid JavaScript identifiers', async () => {
      mockClient.addResource({
        key: '123invalid.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });
      mockClient.addResource({
        key: 'file-with-dash.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });
      mockClient.addResource({
        key: 'valid_file.txt',
        type: 'text',
        size: 100,
        lastModified: new Date().toISOString(),
        local: false, // Default to false for existing tests
      });

      await generateTypes(projectPath, mockClient);

      const typesPath = path.join(projectPath, 'resources.d.ts');
      const content = fs.readFileSync(typesPath, 'utf-8');

      // Should include valid identifier
      expect(content).toContain('valid_file: TextResource;');

      // Should not include invalid identifiers
      expect(content).not.toContain('123invalid');
      expect(content).not.toContain('file-with-dash');
    });

    it('should handle API errors gracefully', async () => {
      // Create a client that returns an error
      const errorClient = createMockApiClient();
      errorClient.fetch = async (path: string, options?: any) => {
        return new Response('Internal Server Error', { status: 500 });
      };

      await expect(generateTypes(projectPath, errorClient)).rejects.toThrow(
        'Failed to fetch resources: 500 Internal Server Error'
      );
    });
  });
});
