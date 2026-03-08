import type { R2Bucket } from '@cloudflare/workers-types';
import type { StoreProvider } from '@positronic/core';

/**
 * R2-backed StoreProvider. One R2 object per key at `store/{key}.json`.
 * Uses the existing RESOURCES_BUCKET — safe because `loadResourcesFromR2()`
 * skips objects without `customMetadata.type`.
 */
export class R2StoreProvider implements StoreProvider {
  constructor(private bucket: R2Bucket) {}

  private keyPath(key: string): string {
    return `store/${key}.json`;
  }

  async get(key: string) {
    const object = await this.bucket.get(this.keyPath(key));
    if (object === null) {
      return undefined;
    }
    const text = await object.text();
    return JSON.parse(text);
  }

  async set(key: string, value: Parameters<StoreProvider['set']>[1]) {
    await this.bucket.put(this.keyPath(key), JSON.stringify(value));
  }

  async delete(key: string) {
    await this.bucket.delete(this.keyPath(key));
  }

  async has(key: string) {
    const object = await this.bucket.head(this.keyPath(key));
    return object !== null;
  }
}
