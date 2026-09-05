import { Hono, type Context } from 'hono';
import type { Bindings } from './types.js';

const bundle = new Hono<{ Bindings: Bindings }>();

/**
 * The files the dev server (and deploy) build from the project's
 * .positronic/bundle.ts and .positronic/styles.css and upload under bundle/.
 * Generated pages load both.
 */
const files: Record<string, { contentType: string; notFound: string }> = {
  'components.js': {
    contentType: 'application/javascript; charset=utf-8',
    notFound:
      '// Bundle not found. Run the dev server to build the component bundle.\n' +
      'console.error("Component bundle not found. Make sure the dev server is running and has built the bundle.");',
  },
  'components.css': {
    contentType: 'text/css; charset=utf-8',
    notFound:
      '/* Bundle not found. Run the dev server to build the component bundle. */',
  },
};

bundle.get('/:file', async (context: Context) => {
  const name = context.req.param('file');
  const file = files[name];
  if (!file) {
    return context.notFound();
  }

  const bucket = context.env.RESOURCES_BUCKET;
  const headers = { 'Content-Type': file.contentType };

  try {
    const r2Object = await bucket.get(`bundle/${name}`);

    if (!r2Object) {
      return new Response(file.notFound, { status: 404, headers });
    }

    return new Response(await r2Object.text(), {
      status: 200,
      headers: {
        ...headers,
        'Cache-Control': 'no-cache', // Don't cache during development
      },
    });
  } catch (error) {
    console.error('Error serving bundle:', error);
    return new Response(
      `/* Error loading bundle: ${
        error instanceof Error ? error.message : 'Unknown error'
      } */`,
      { status: 500, headers }
    );
  }
});

export default bundle;
