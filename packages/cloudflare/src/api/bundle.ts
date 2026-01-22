import { Hono, type Context } from 'hono';
import type { Bindings } from './types.js';

const bundle = new Hono<{ Bindings: Bindings }>();

/**
 * Serve the component bundle.
 * In development, the bundle is stored in R2 bucket under 'bundle/components.js'.
 * The dev server builds this bundle on startup from the project's components/ directory.
 */
bundle.get('/components.js', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;
  const key = 'bundle/components.js';

  try {
    const r2Object = await bucket.get(key);

    if (!r2Object) {
      // Return a helpful error message if the bundle doesn't exist
      return new Response(
        '// Bundle not found. Run the dev server to build the component bundle.\n' +
          'console.error("Component bundle not found. Make sure the dev server is running and has built the bundle.");',
        {
          status: 404,
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
          },
        }
      );
    }

    const js = await r2Object.text();

    return new Response(js, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache', // Don't cache during development
      },
    });
  } catch (error) {
    console.error('Error serving bundle:', error);
    return new Response(
      `// Error loading bundle: ${error instanceof Error ? error.message : 'Unknown error'}`,
      {
        status: 500,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
        },
      }
    );
  }
});

export default bundle;
