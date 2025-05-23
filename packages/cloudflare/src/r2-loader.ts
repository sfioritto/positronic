import type { R2Bucket } from '@cloudflare/workers-types';
import type { ResourceLoader } from '@positronic/core';
import { Buffer } from 'buffer';

export class CloudflareR2Loader implements ResourceLoader {
  constructor(private bucket: R2Bucket) {}

  async load(resourceName: string, type: 'text'): Promise<string>;
  async load(resourceName: string, type: 'binary'): Promise<Buffer>;
  async load(
    resourceName: string,
    type: 'text' | 'binary' = 'text'
  ): Promise<string | Buffer> {
    const object = await this.bucket.get(resourceName);

    if (object === null) {
      throw new Error(`Resource "${resourceName}" not found in R2 bucket.`);
    }

    if (type === 'binary') {
      const arrayBuffer = await object.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    // Defaults to text
    return object.text();
  }
}
