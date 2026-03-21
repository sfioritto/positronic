import { Hono, type Context } from 'hono';
import type { Bindings } from './types.js';
import { guessContentType } from '../content-type.js';

const files = new Hono<{ Bindings: Bindings }>();

/**
 * GET /files/* — serves file content from R2.
 * URL path is /files/user/{userName}/{brainTitle}/{name}
 * R2 key is files/user/{userName}/{brainTitle}/{name} (prepend "files/" prefix)
 * Public endpoint (no auth) so download URLs work in browsers.
 */
files.get('/*', async (context: Context) => {
  const path = context.req.path.replace(/^\/files\//, '');

  if (!path) {
    return context.json({ error: 'File path is required' }, 400);
  }

  // Reconstruct the R2 key by adding the "files/" namespace prefix
  const key = `files/${path}`;

  const bucket = context.env.RESOURCES_BUCKET;
  const object = await bucket.get(key);

  if (!object) {
    return context.json({ error: 'File not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  // If no content-type was stored, infer from the key
  if (!headers.get('content-type')) {
    headers.set('content-type', guessContentType(key));
  }

  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default files;
