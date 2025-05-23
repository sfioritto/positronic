import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { CloudflareR2Loader } from '../../src/r2-loader.js';
import { Buffer } from 'buffer';
import type { BrainRunnerDO } from '../../src/brain-runner-do.js'; // Keep for TestEnv consistency if other tests use it
import type { MonitorDO } from '../../src/monitor-do.js'; // Keep for TestEnv consistency

// Define TestEnv locally or import from a shared types file if it becomes common
interface TestEnv {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  DB: D1Database;
  TEST_RESOURCES_BUCKET: R2Bucket;
}

describe('CloudflareR2Loader Tests', () => {
  const testEnv = env as TestEnv;
  let r2Loader: CloudflareR2Loader;
  const textFileName = 'test.txt';
  const textFileContent = 'Hello R2!';
  const binaryFileName = 'test.bin';
  const binaryFileContent = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const nonExistentFileName = 'not-found.txt';

  beforeAll(async () => {
    // Initialize loader
    if (!testEnv.TEST_RESOURCES_BUCKET) {
      throw new Error(
        'TEST_RESOURCES_BUCKET binding not found in test environment. Ensure wrangler.jsonc is configured and wrangler types generated.'
      );
    }
    r2Loader = new CloudflareR2Loader(testEnv.TEST_RESOURCES_BUCKET);

    // Populate R2 bucket with test files
    await testEnv.TEST_RESOURCES_BUCKET.put(textFileName, textFileContent);
    await testEnv.TEST_RESOURCES_BUCKET.put(
      binaryFileName,
      binaryFileContent.buffer // R2 put expects ArrayBuffer for binary
    );

    // Clean up any pre-existing non-existent file to ensure test is valid
    await testEnv.TEST_RESOURCES_BUCKET.delete(nonExistentFileName);
  });

  it('should load a text file from R2', async () => {
    const content = await r2Loader.load(textFileName, 'text');
    expect(content).toBe(textFileContent);
  });

  it('should load a binary file from R2 and return as Buffer', async () => {
    const content = await r2Loader.load(binaryFileName, 'binary');
    expect(content).toBeInstanceOf(Buffer);
    expect(Buffer.compare(content, binaryFileContent)).toBe(0);
  });

  it('should throw an error if the resource is not found', async () => {
    await expect(r2Loader.load(nonExistentFileName, 'text')).rejects.toThrow(
      `Resource "${nonExistentFileName}" not found in R2 bucket.`
    );
  });

  it('should default to loading as text if type is not specified', async () => {
    const content = (await r2Loader.load(textFileName, 'text')) as string;
    expect(content).toBe(textFileContent);
  });

  // Optional: Test with a file in a subdirectory to ensure paths are handled
  it('should load a text file from a subdirectory in R2', async () => {
    const subDirFileName = 'subdir/another.txt';
    const subDirFileContent = 'Hello from subdirectory!';
    await testEnv.TEST_RESOURCES_BUCKET.put(subDirFileName, subDirFileContent);

    const content = await r2Loader.load(subDirFileName, 'text');
    expect(content).toBe(subDirFileContent);

    await testEnv.TEST_RESOURCES_BUCKET.delete(subDirFileName); // Clean up
  });
});
