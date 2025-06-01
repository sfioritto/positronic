import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import worker from '../src/index';

interface TestEnv {
  RESOURCES_BUCKET: R2Bucket;
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
    }>();
    expect(responseBody).toEqual({
      type: 'text',
      path: 'resources/test-files/test.txt',
      key: 'resources/test-files/test.txt',
      size: expect.any(Number),
      lastModified: expect.any(String),
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
    }>();
    expect(responseBody).toEqual({
      type: 'binary',
      key: 'videos/large-video.mp4',
      size: expect.any(Number),
      lastModified: expect.any(String),
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
    }>();
    expect(responseBody).toEqual({
      type: 'binary',
      path: 'resources/images/logo.png',
      key: 'assets/branding/logo.png',
      size: expect.any(Number),
      lastModified: expect.any(String),
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
    });
  });

  describe('Error cases', () => {
    it('POST /resources without file should return 500 error', async () => {
      const formData = new FormData();
      formData.append('type', 'text');
      formData.append('path', 'resources/test.txt');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(500);

      await waitOnExecutionContext(context);
    });

    it('POST /resources without type should return 500 error', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['content']), 'test.txt');
      formData.append('path', 'resources/test.txt');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(500);

      await waitOnExecutionContext(context);
    });

    it('POST /resources with invalid type should return 500 error', async () => {
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
      expect(response.status).toBe(500);

      await waitOnExecutionContext(context);
    });

    it('POST /resources without key or path should return 500 error', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['content']), 'test.txt');
      formData.append('type', 'text');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });
      const context = createExecutionContext();

      const response = await worker.fetch(request, testEnv, context);
      expect(response.status).toBe(500);

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
});
