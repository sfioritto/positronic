import type { R2Bucket } from '@cloudflare/workers-types';
import type { StoreProvider, Store } from '@positronic/core';

/**
 * Type guard for per-user field definitions in a store schema.
 */
function isPerUserField(value: unknown): value is { type: unknown; perUser: true } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'perUser' in value &&
    (value as any).perUser === true &&
    'type' in value
  );
}

/**
 * Create a StoreProvider backed by Cloudflare R2.
 *
 * Key resolution:
 *   shared:   store/{brainTitle}/{key}.json
 *   per-user: store/{brainTitle}/user/{userName}/{key}.json
 *
 * The factory receives the store schema, brain title, and currentUser,
 * and returns a typed Store<any> with full key resolution built in.
 */
export function createR2Backend(bucket: R2Bucket): StoreProvider {
  return ({ schema, brainTitle, currentUser }) => {
    // Parse which keys are per-user from the schema
    const perUserKeys = new Set<string>();
    for (const [key, value] of Object.entries(schema)) {
      if (isPerUserField(value)) {
        perUserKeys.add(key);
      }
    }

    function resolveKey(key: string): string {
      if (perUserKeys.has(key)) {
        if (!currentUser) {
          throw new Error(
            `Store key "${key}" is per-user but no currentUser was provided. ` +
            `Per-user store keys require a currentUser in run params.`
          );
        }
        return `store/${brainTitle}/user/${currentUser.name}/${key}`;
      }
      return `store/${brainTitle}/${key}`;
    }

    const store: Store<any> = {
      async get(key: string) {
        const resolved = resolveKey(key);
        const object = await bucket.get(`${resolved}.json`);
        if (object === null) return undefined;
        return JSON.parse(await object.text());
      },
      async set(key: string, value: any) {
        const resolved = resolveKey(key);
        await bucket.put(`${resolved}.json`, JSON.stringify(value));
      },
      async delete(key: string) {
        const resolved = resolveKey(key);
        await bucket.delete(`${resolved}.json`);
      },
      async has(key: string) {
        const resolved = resolveKey(key);
        const object = await bucket.head(`${resolved}.json`);
        return object !== null;
      },
    };

    return store;
  };
}
