import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { R2StoreProvider } from '../../src/r2-store-provider.js';
import type { BrainRunnerDO } from '../../src/brain-runner-do.js';
import type { MonitorDO } from '../../src/monitor-do.js';

interface TestEnv {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  DB: D1Database;
  TEST_RESOURCES_BUCKET: R2Bucket;
}

describe('R2StoreProvider', () => {
  const testEnv = env as TestEnv;
  let store: R2StoreProvider;

  beforeEach(async () => {
    store = new R2StoreProvider(testEnv.TEST_RESOURCES_BUCKET);

    // Clean up store keys from previous tests
    const listed = await testEnv.TEST_RESOURCES_BUCKET.list({ prefix: 'store/' });
    for (const obj of listed.objects) {
      await testEnv.TEST_RESOURCES_BUCKET.delete(obj.key);
    }
  });

  it('should return undefined for a missing key', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should set and get a string value', async () => {
    await store.set('name', 'test-value');
    const result = await store.get('name');
    expect(result).toBe('test-value');
  });

  it('should set and get an array value', async () => {
    const items = ['a', 'b', 'c'];
    await store.set('items', items);
    const result = await store.get('items');
    expect(result).toEqual(items);
  });

  it('should set and get a number value', async () => {
    await store.set('count', 42);
    const result = await store.get('count');
    expect(result).toBe(42);
  });

  it('should set and get a nested object', async () => {
    const data = { nested: { key: 'value' }, list: [1, 2, 3] };
    await store.set('data', data);
    const result = await store.get('data');
    expect(result).toEqual(data);
  });

  it('should overwrite an existing value', async () => {
    await store.set('key', 'first');
    await store.set('key', 'second');
    const result = await store.get('key');
    expect(result).toBe('second');
  });

  it('should delete a key', async () => {
    await store.set('key', 'value');
    expect(await store.has('key')).toBe(true);

    await store.delete('key');
    expect(await store.has('key')).toBe(false);
    expect(await store.get('key')).toBeUndefined();
  });

  it('should check if a key exists', async () => {
    expect(await store.has('key')).toBe(false);

    await store.set('key', 'value');
    expect(await store.has('key')).toBe(true);
  });

  it('should store values at store/ prefix in R2', async () => {
    await store.set('mykey', 'myvalue');

    // Verify the R2 object is at the expected path
    const obj = await testEnv.TEST_RESOURCES_BUCKET.get('store/mykey.json');
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(JSON.parse(text)).toBe('myvalue');
  });

  it('should not interfere with non-store R2 objects', async () => {
    // Put a resource object (non-store)
    await testEnv.TEST_RESOURCES_BUCKET.put('resource.txt', 'hello', {
      customMetadata: { type: 'text', path: 'resource.txt' },
    });

    // Store a value
    await store.set('key', 'value');

    // Verify resource is untouched
    const resource = await testEnv.TEST_RESOURCES_BUCKET.get('resource.txt');
    expect(resource).not.toBeNull();
    expect(await resource!.text()).toBe('hello');

    // Clean up
    await testEnv.TEST_RESOURCES_BUCKET.delete('resource.txt');
  });
});
