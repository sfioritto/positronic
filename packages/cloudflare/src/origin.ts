import type { R2Bucket } from '@cloudflare/workers-types';

const ORIGIN_KEY = '__config/origin';

/**
 * Read the origin URL from R2 config.
 * Falls back to http://localhost:8787 if not found (dev safety).
 */
export async function getOrigin(bucket: R2Bucket): Promise<string> {
  const obj = await bucket.get(ORIGIN_KEY);
  if (obj) {
    return (await obj.text()).trim();
  }
  return 'http://localhost:8787';
}
