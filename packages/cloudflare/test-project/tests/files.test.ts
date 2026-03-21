import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createFilesService } from '../../src/files-service.js';
import type { FilesService } from '@positronic/core';

interface TestEnv {
  TEST_RESOURCES_BUCKET: R2Bucket;
}

describe('createFilesService', () => {
  const testEnv = env as TestEnv;

  function createService(
    brainTitle = 'test-brain',
    brainRunId = 'run-123',
    currentUser = { name: 'test-user' }
  ): FilesService {
    return createFilesService(
      testEnv.TEST_RESOURCES_BUCKET,
      brainTitle,
      brainRunId,
      currentUser,
      { origin: 'http://localhost:8787', secrets: {} }
    );
  }

  it('should write and read text content', async () => {
    const service = createService();
    const file = service.open('hello.txt');
    await file.write('hello world');

    const content = await file.read();
    expect(content).toBe('hello world');
  });

  it('should write and read binary content', async () => {
    const service = createService();
    const file = service.open('data.bin');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await file.write(bytes);

    const readBack = await file.readBytes();
    expect(readBack).toEqual(bytes);
  });

  it('should compute url from origin and scoped key', async () => {
    const service = createService();
    const file = service.open('report.txt');
    expect(file.url).toBe(
      'http://localhost:8787/files/user/test-user/test-brain/report.txt'
    );
  });

  it('should report existence correctly', async () => {
    const service = createService();
    const file = service.open('maybe.txt');

    expect(await file.exists()).toBe(false);
    await file.write('exists now');
    expect(await file.exists()).toBe(true);
  });

  it('should delete files', async () => {
    const service = createService();
    const file = service.open('temp.txt');
    await file.write('temporary');

    expect(await file.exists()).toBe(true);
    await file.delete();
    expect(await file.exists()).toBe(false);
  });

  it('should overwrite existing files', async () => {
    const service = createService();
    const file = service.open('overwrite.txt');
    await file.write('first');
    await file.write('second');

    const content = await file.read();
    expect(content).toBe('second');
  });

  it('should throw when reading non-existent file', async () => {
    const service = createService();
    const file = service.open('missing.txt');

    await expect(file.read()).rejects.toThrow("File 'missing.txt' not found");
  });

  it('should list files in brain scope', async () => {
    const service = createService();
    await service.write('file1.txt', 'content 1');
    await service.write('file2.txt', 'content 2');

    const files = await service.list();
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['file1.txt', 'file2.txt']);
  });

  it('should use convenience write method', async () => {
    const service = createService();
    const ref = await service.write('quick.txt', 'fast');
    expect(ref.name).toBe('quick.txt');

    const content = await service.open('quick.txt').read();
    expect(content).toBe('fast');
  });

  it('should delete via service convenience method', async () => {
    const service = createService();
    await service.write('to-delete.txt', 'bye');
    await service.delete('to-delete.txt');

    expect(await service.open('to-delete.txt').exists()).toBe(false);
  });

  it('should scope brain files per user and brain', async () => {
    const service = createService();
    await service.write('data.txt', 'brain-scoped');

    const object = await testEnv.TEST_RESOURCES_BUCKET.get(
      'files/user/test-user/test-brain/data.txt'
    );
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe('brain-scoped');
  });

  it('should scope run files per run', async () => {
    const service = createService();
    await service.write('temp.txt', 'run-scoped', { scope: 'run' });

    const object = await testEnv.TEST_RESOURCES_BUCKET.get(
      'files/user/test-user/test-brain/runs/run-123/temp.txt'
    );
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe('run-scoped');
  });

  it('should scope global files per user only', async () => {
    const service = createService();
    await service.write('shared.txt', 'global-scoped', { scope: 'global' });

    const object = await testEnv.TEST_RESOURCES_BUCKET.get(
      'files/user/test-user/shared.txt'
    );
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe('global-scoped');
  });

  it('should isolate files between users', async () => {
    const service1 = createService('test-brain', 'run-1', {
      name: 'alice',
    });
    const service2 = createService('test-brain', 'run-2', { name: 'bob' });

    await service1.write('secret.txt', 'alice data');
    await service2.write('secret.txt', 'bob data');

    const aliceContent = await service1.open('secret.txt').read();
    const bobContent = await service2.open('secret.txt').read();

    expect(aliceContent).toBe('alice data');
    expect(bobContent).toBe('bob data');
  });

  it('should not include run-scoped files in list', async () => {
    const service = createService();
    await service.write('brain-file.txt', 'brain');
    await service.write('run-file.txt', 'run', { scope: 'run' });

    const files = await service.list();
    const names = files.map((f) => f.name);
    expect(names).toContain('brain-file.txt');
    expect(names).not.toContain('run-file.txt');
  });

  it('should copy content from one file to another', async () => {
    const service = createService();
    const source = service.open('source.txt');
    await source.write('original content');

    const dest = service.open('dest.txt');
    await dest.write(source);

    const content = await dest.read();
    expect(content).toBe('original content');
  });

  it('should store content type based on file extension', async () => {
    const service = createService();
    await service.write('data.json', '{"key": "value"}');

    // Use head() to avoid unconsumed body stream issues with isolated storage
    const object = await testEnv.TEST_RESOURCES_BUCKET.head(
      'files/user/test-user/test-brain/data.json'
    );
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentType).toBe('application/json');
  });
});
