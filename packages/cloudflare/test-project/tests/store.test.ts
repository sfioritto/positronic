import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { createR2Backend } from '../../src/create-r2-store.js';
import type { Store } from '@positronic/core';

interface TestEnv {
  TEST_RESOURCES_BUCKET: R2Bucket;
}

describe('createR2Backend', () => {
  const testEnv = env as TestEnv;

  beforeEach(async () => {
    // Clean up store keys from previous tests
    const listed = await testEnv.TEST_RESOURCES_BUCKET.list();
    for (const obj of listed.objects) {
      if (obj.key.endsWith('.json')) {
        await testEnv.TEST_RESOURCES_BUCKET.delete(obj.key);
      }
    }
  });

  function createStore(
    schema: Record<string, any> = { key: z.string() },
    currentUser?: { name: string }
  ): Store<any> {
    const factory = createR2Backend(testEnv.TEST_RESOURCES_BUCKET);
    return factory({ schema, brainTitle: 'test-brain', currentUser });
  }

  it('should return undefined for a missing key', async () => {
    const store = createStore();
    const result = await store.get('key');
    expect(result).toBeUndefined();
  });

  it('should set and get a string value', async () => {
    const store = createStore({ name: z.string() });
    await store.set('name', 'test-value');
    const result = await store.get('name');
    expect(result).toBe('test-value');
  });

  it('should set and get an array value', async () => {
    const store = createStore({ items: z.array(z.string()) });
    const items = ['a', 'b', 'c'];
    await store.set('items', items);
    const result = await store.get('items');
    expect(result).toEqual(items);
  });

  it('should set and get a number value', async () => {
    const store = createStore({ count: z.number() });
    await store.set('count', 42);
    const result = await store.get('count');
    expect(result).toBe(42);
  });

  it('should set and get a nested object', async () => {
    const store = createStore({
      data: z.object({
        nested: z.object({ key: z.string() }),
        list: z.array(z.number()),
      }),
    });
    const data = { nested: { key: 'value' }, list: [1, 2, 3] };
    await store.set('data', data);
    const result = await store.get('data');
    expect(result).toEqual(data);
  });

  it('should overwrite an existing value', async () => {
    const store = createStore({ key: z.string() });
    await store.set('key', 'first');
    await store.set('key', 'second');
    const result = await store.get('key');
    expect(result).toBe('second');
  });

  it('should delete a key', async () => {
    const store = createStore({ key: z.string() });
    await store.set('key', 'value');
    expect(await store.has('key')).toBe(true);

    await store.delete('key');
    expect(await store.has('key')).toBe(false);
    expect(await store.get('key')).toBeUndefined();
  });

  it('should check if a key exists', async () => {
    const store = createStore({ key: z.string() });
    expect(await store.has('key')).toBe(false);

    await store.set('key', 'value');
    expect(await store.has('key')).toBe(true);
  });

  it('should store shared keys at store/{brainTitle}/{key}.json in R2', async () => {
    const store = createStore({ mykey: z.string() });
    await store.set('mykey', 'myvalue');

    // Verify the R2 object is at the expected path
    const obj = await testEnv.TEST_RESOURCES_BUCKET.get(
      'store/test-brain/mykey.json'
    );
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(JSON.parse(text)).toBe('myvalue');
  });

  it('should store per-user keys at store/{brainTitle}/user/{userName}/{key}.json in R2', async () => {
    const store = createStore(
      { pref: { type: z.string(), perUser: true } },
      { name: 'user-42' }
    );
    await store.set('pref', 'dark');

    const obj = await testEnv.TEST_RESOURCES_BUCKET.get(
      'store/test-brain/user/user-42/pref.json'
    );
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(JSON.parse(text)).toBe('dark');
  });

  it('should isolate per-user data between different users', async () => {
    const schema = { pref: { type: z.string(), perUser: true } };

    const storeUserA = createStore(schema, { name: 'user-A' });
    const storeUserB = createStore(schema, { name: 'user-B' });

    await storeUserA.set('pref', 'dark');
    await storeUserB.set('pref', 'light');

    expect(await storeUserA.get('pref')).toBe('dark');
    expect(await storeUserB.get('pref')).toBe('light');
  });

  it('should share non-per-user data across users', async () => {
    const schema = {
      globalConfig: z.string(),
      userPref: { type: z.string(), perUser: true },
    };

    const storeUserA = createStore(schema, { name: 'user-A' });
    const storeUserB = createStore(schema, { name: 'user-B' });

    await storeUserA.set('globalConfig', 'v2');
    await storeUserA.set('userPref', 'dark');

    // User B sees the shared config but not user A's preference
    expect(await storeUserB.get('globalConfig')).toBe('v2');
    expect(await storeUserB.get('userPref')).toBeUndefined();
  });

  it('should throw when accessing per-user key without currentUser', async () => {
    const store = createStore(
      { pref: { type: z.string(), perUser: true } }
      // no currentUser
    );

    await expect(store.get('pref')).rejects.toThrow(
      /per-user but no currentUser/
    );
  });
});
