import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import worker from '../src/index';

interface TestEnv {
  RESOURCES_BUCKET: R2Bucket;
  NODE_ENV?: string;
}

describe('Resources API Tests', () => {
  const testEnv = env as TestEnv;

  beforeAll(async () => {
    // Clean up any existing test resources
    try {
      const listed = await testEnv.RESOURCES_BUCKET.list();
      for (const obj of listed.objects) {
        await testEnv.RESOURCES_BUCKET.delete(obj.key);
      }
    } catch (e) {
      // Ignore errors if bucket is empty
    }
  });

  afterAll(async () => {
    // Clean up after all tests
    try {
      const listed = await testEnv.RESOURCES_BUCKET.list();
      for (const obj of listed.objects) {
        await testEnv.RESOURCES_BUCKET.delete(obj.key);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  it('POST /resources with path only', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob(['Hello from test file'], { type: 'text/plain' }),
      'test.txt'
    );
    formData.append('type', 'text');
    formData.append('path', 'resources/test-files/test.txt');
    formData.append('local', 'false');

    const request = new Request('http://example.com/resources', {
      method: 'POST',
      body: formData,
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(201);
    const responseBody = await response.json<{
      type: string;
      path: string;
      key: string;
      size: number;
      lastModified: string;
      local: boolean;
    }>();
    expect(responseBody).toEqual({
      type: 'text',
      path: 'resources/test-files/test.txt',
      key: 'resources/test-files/test.txt',
      size: expect.any(Number),
      lastModified: expect.any(String),
      local: false,
    });

    // Verify the resource was actually stored in R2
    const storedObject = await testEnv.RESOURCES_BUCKET.get(
      'resources/test-files/test.txt'
    );
    expect(storedObject).not.toBeNull();
    const storedText = await storedObject!.text();
    expect(storedText).toBe('Hello from test file');
    expect(storedObject!.customMetadata).toEqual({
      type: 'text',
      path: 'resources/test-files/test.txt',
      local: 'false',
    });
  });

  it('POST /resources with key only (no path)', async () => {
    const formData = new FormData();
    const videoContent = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    ]); // Mock video header
    formData.append(
      'file',
      new Blob([videoContent], { type: 'video/mp4' }),
      'video.mp4'
    );
    formData.append('type', 'binary');
    formData.append('key', 'videos/large-video.mp4');
    formData.append('local', 'false');

    const request = new Request('http://example.com/resources', {
      method: 'POST',
      body: formData,
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(201);
    const responseBody = await response.json<{
      type: string;
      path?: string;
      key: string;
      size: number;
      lastModified: string;
      local: boolean;
    }>();
    expect(responseBody).toEqual({
      type: 'binary',
      key: 'videos/large-video.mp4',
      size: expect.any(Number),
      lastModified: expect.any(String),
      local: false,
    });
    // Should not have path since we didn't provide one
    expect(responseBody.path).toBeUndefined();

    // Verify the resource was stored without path metadata
    const storedObject = await testEnv.RESOURCES_BUCKET.get(
      'videos/large-video.mp4'
    );
    expect(storedObject).not.toBeNull();
    // IMPORTANT: Consume the response body to avoid isolated storage issues
    await storedObject!.arrayBuffer();
    expect(storedObject!.customMetadata).toEqual({
      type: 'binary',
      local: 'false',
    });
  });

  it('POST /resources with both key and path (key takes precedence)', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob(['Image data'], { type: 'image/png' }),
      'logo.png'
    );
    formData.append('type', 'binary');
    formData.append('path', 'resources/images/logo.png');
    formData.append('key', 'assets/branding/logo.png');
    formData.append('local', 'true'); // Testing with local=true

    const request = new Request('http://example.com/resources', {
      method: 'POST',
      body: formData,
    });
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(201);
    const responseBody = await response.json<{
      type: string;
      path: string;
      key: string;
      size: number;
      lastModified: string;
      local: boolean;
    }>();
    expect(responseBody).toEqual({
      type: 'binary',
      path: 'resources/images/logo.png',
      key: 'assets/branding/logo.png',
      size: expect.any(Number),
      lastModified: expect.any(String),
      local: true,
    });

    // Verify stored at key location, not path location
    const storedAtKey = await testEnv.RESOURCES_BUCKET.get(
      'assets/branding/logo.png'
    );
    expect(storedAtKey).not.toBeNull();
    // IMPORTANT: Consume the response body
    await storedAtKey!.arrayBuffer();

    const storedAtPath = await testEnv.RESOURCES_BUCKET.get(
      'resources/images/logo.png'
    );
    expect(storedAtPath).toBeNull();
  });

  it('GET /resources lists all resources correctly', async () => {
    // First create a resource to list
    const formData = new FormData();
    formData.append(
      'file',
      new Blob(['Test content'], { type: 'text/plain' }),
      'test.txt'
    );
    formData.append('type', 'text');
    formData.append('path', 'resources/list-test.txt');
    formData.append('local', 'true');

    const createRequest = new Request('http://example.com/resources', {
      method: 'POST',
      body: formData,
    });
    const createContext = createExecutionContext();
    await worker.fetch(createRequest, testEnv, createContext);
    await waitOnExecutionContext(createContext);

    // Now list resources
    const request = new Request('http://example.com/resources');
    const context = createExecutionContext();
    const response = await worker.fetch(request, testEnv, context);
    await waitOnExecutionContext(context);

    expect(response.status).toBe(200);
    const responseBody = await response.json<{
      resources: Array<{
        type: string;
        path?: string;
        key: string;
        size: number;
        lastModified: string;
        local: boolean;
      }>;
      truncated: boolean;
      count: number;
    }>();
    expect(responseBody.truncated).toBe(false);
    // Should have 1 resource (the one we just created)
    expect(responseBody.count).toBe(1);
    expect(responseBody.resources).toHaveLength(1);

    // Check that the resource has the correct structure
    const resource = responseBody.resources[0];
    expect(resource).toEqual({
      type: 'text',
      path: 'resources/list-test.txt',
      key: 'resources/list-test.txt',
      size: expect.any(Number),
      lastModified: expect.any(String),
      local: true,
    });
  });

  describe('Error cases', () => {
    it('POST /resources without file should return 400 error', async () => {
      const formData = new FormData();
      formData.append('type', 'text');
      formData.append('path', 'resources/test.txt');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(400);

      await waitOnExecutionContext(context);
    });

    it('POST /resources without type should return 400 error', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['content']), 'test.txt');
      formData.append('path', 'resources/test.txt');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(400);

      await waitOnExecutionContext(context);
    });

    it('POST /resources with invalid type should return 400 error', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['content']), 'test.txt');
      formData.append('type', 'invalid');
      formData.append('path', 'resources/test.txt');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(400);

      await waitOnExecutionContext(context);
    });

    it('POST /resources without key or path should return 400 error', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['content']), 'test.txt');
      formData.append('type', 'text');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(400);

      await waitOnExecutionContext(context);
    });

    it('GET /resources with missing type metadata should return 500 error', async () => {
      // Manually create a resource without type metadata
      await testEnv.RESOURCES_BUCKET.put('bad-resource.txt', 'content', {
        customMetadata: {
          path: 'bad-resource.txt',
          // Missing type
        },
      });

      const request = new Request('http://example.com/resources');
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(500);

      await waitOnExecutionContext(context);

      // Clean up
      await testEnv.RESOURCES_BUCKET.delete('bad-resource.txt');
    });
  });

  describe('DELETE /resources/:key', () => {
    it('should delete an existing resource', async () => {
      // First create a resource
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['Content to delete'], { type: 'text/plain' }),
        'delete-test.txt'
      );
      formData.append('type', 'text');
      formData.append('key', 'resources/delete-test.txt');

      const createRequest = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const createContext = createExecutionContext();
      const createResponse = await worker.fetch(
        createRequest,
        testEnv,
        createContext
      );
      await waitOnExecutionContext(createContext);
      expect(createResponse.status).toBe(201);

      // Now delete it
      const deleteRequest = new Request(
        'http://example.com/resources/' +
          encodeURIComponent('resources/delete-test.txt'),
        { method: 'DELETE' }
      );
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        testEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const deletedObject = await testEnv.RESOURCES_BUCKET.get(
        'resources/delete-test.txt'
      );
      expect(deletedObject).toBeNull();
    });

    it('should handle URL encoded keys with slashes', async () => {
      // Create a resource with a path containing subdirectories
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['Nested content'], { type: 'text/plain' }),
        'nested.txt'
      );
      formData.append('type', 'text');
      formData.append('key', 'resources/subfolder/nested.txt');

      const createRequest = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const createContext = createExecutionContext();
      await worker.fetch(createRequest, testEnv, createContext);
      await waitOnExecutionContext(createContext);

      // Delete with URL encoded key
      const deleteRequest = new Request(
        'http://example.com/resources/' +
          encodeURIComponent('resources/subfolder/nested.txt'),
        { method: 'DELETE' }
      );
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        testEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(204);

      // Verify it's deleted
      const deletedObject = await testEnv.RESOURCES_BUCKET.get(
        'resources/subfolder/nested.txt'
      );
      expect(deletedObject).toBeNull();
    });

    it('should return 204 even for non-existent resources (idempotent delete)', async () => {
      const deleteRequest = new Request(
        'http://example.com/resources/' +
          encodeURIComponent('non-existent.txt'),
        { method: 'DELETE' }
      );
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        testEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      // Should return 204 No Content even if resource doesn't exist (idempotent)
      expect(deleteResponse.status).toBe(204);
    });
  });

  describe('DELETE /resources (bulk delete)', () => {
    beforeEach(async () => {
      // Create some test resources
      const resources = ['file1.txt', 'file2.txt', 'subfolder/file3.txt'];

      for (const resource of resources) {
        const formData = new FormData();
        formData.append(
          'file',
          new Blob([`Content of ${resource}`], { type: 'text/plain' }),
          resource
        );
        formData.append('type', 'text');
        formData.append('key', `resources/${resource}`);

        const request = new Request('http://example.com/resources', {
          method: 'POST',
          body: formData,
        });
        const context = createExecutionContext();
        await worker.fetch(request, testEnv, context);
        await waitOnExecutionContext(context);
      }
    });

    it('should delete all resources when in development mode', async () => {
      // Explicitly set environment to development mode
      const devEnv = {
        ...testEnv,
        NODE_ENV: 'development',
      };

      const deleteRequest = new Request('http://example.com/resources', {
        method: 'DELETE',
      });
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        devEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(200);
      const responseBody = await deleteResponse.json<{
        deletedCount: number;
      }>();
      expect(responseBody.deletedCount).toBeGreaterThanOrEqual(3);

      // Verify all resources are deleted
      const listed = await testEnv.RESOURCES_BUCKET.list();
      expect(listed.objects.length).toBe(0);
    });

    it('should return 403 when not in development mode', async () => {
      // Create an environment without NODE_ENV
      const envWithoutNodeEnv = {
        RESOURCES_BUCKET: testEnv.RESOURCES_BUCKET,
        // Explicitly omit NODE_ENV
      };

      const deleteRequest = new Request('http://example.com/resources', {
        method: 'DELETE',
      });
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        envWithoutNodeEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(403);
      const errorBody = await deleteResponse.json<{ error: string }>();
      expect(errorBody.error).toBe(
        'Bulk delete is only available in development mode'
      );

      // Verify resources are not deleted
      const listed = await testEnv.RESOURCES_BUCKET.list();
      expect(listed.objects.length).toBeGreaterThanOrEqual(3);
    });

    it('should return 403 when NODE_ENV is production', async () => {
      const prodEnv = {
        ...testEnv,
        NODE_ENV: 'production',
      };

      const deleteRequest = new Request('http://example.com/resources', {
        method: 'DELETE',
      });
      const deleteContext = createExecutionContext();
      const deleteResponse = await worker.fetch(
        deleteRequest,
        prodEnv,
        deleteContext
      );
      await waitOnExecutionContext(deleteContext);

      expect(deleteResponse.status).toBe(403);
      const errorBody = await deleteResponse.json<{ error: string }>();
      expect(errorBody.error).toBe(
        'Bulk delete is only available in development mode'
      );
    });
  });

  describe('POST /resources/presigned-link', () => {
    it('should return 400 when R2 credentials are not configured', async () => {
      // This test verifies behavior when the backend doesn't have credentials configured
      const request = new Request(
        'http://example.com/resources/presigned-link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: 'test-files/large-video.mp4',
            type: 'binary',
            size: 150 * 1024 * 1024, // 150MB
          }),
        }
      );
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(400);
      const responseBody = await response.json<{ error: string }>();
      expect(responseBody.error).toBeDefined();
      expect(typeof responseBody.error).toBe('string');
    });

    it('should validate required fields in request body', async () => {
      // Missing key
      let request = new Request('http://example.com/resources/presigned-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'binary',
          size: 1024,
        }),
      });
      let context = createExecutionContext();
      let response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);
      expect(response.status).toBe(400);

      // Missing type
      request = new Request('http://example.com/resources/presigned-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: 'test.txt',
          size: 1024,
        }),
      });
      context = createExecutionContext();
      response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);
      expect(response.status).toBe(400);

      // Missing size
      request = new Request('http://example.com/resources/presigned-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: 'test.txt',
          type: 'text',
        }),
      });
      context = createExecutionContext();
      response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);
      expect(response.status).toBe(400);
    });

    it('should validate type field is text or binary', async () => {
      const request = new Request(
        'http://example.com/resources/presigned-link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: 'test.txt',
            type: 'invalid',
            size: 1024,
          }),
        }
      );
      const context = createExecutionContext();
      const response = await worker.fetch(request, testEnv, context);
      await waitOnExecutionContext(context);

      expect(response.status).toBe(400);
      const responseBody = await response.json<{ error: string }>();
      expect(responseBody.error).toContain(
        'type must be either "text" or "binary"'
      );
    });

    // Note: We intentionally do not test successful presigned URL generation
    // as it would require real cloud storage credentials and internet connectivity.
    // The spec test validates the API contract when credentials are configured.
  });
});
