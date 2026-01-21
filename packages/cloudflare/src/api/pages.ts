import { Hono, type Context } from 'hono';
import type { R2Object } from '@cloudflare/workers-types';
import type { Bindings } from './types.js';

/**
 * Get the origin URL for constructing page URLs.
 * Uses WORKER_URL env var if set, otherwise falls back to request URL.
 */
function getOrigin(context: Context): string {
  if (context.env.WORKER_URL) {
    return context.env.WORKER_URL;
  }
  const url = new URL(context.req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Generates a unique slug for pages that don't provide one.
 * Uses brainRunId prefix + random suffix for uniqueness.
 */
function generateUniqueSlug(brainRunId: string): string {
  const shortId = brainRunId.slice(0, 8);
  const random = Math.random().toString(36).substring(2, 10);
  return `page-${shortId}-${random}`;
}

const pages = new Hono<{ Bindings: Bindings }>();

// Create a new page
pages.post('/', async (context: Context) => {
  try {
    const body = await context.req.json();
    let { slug, html, brainRunId, persist = false, ttl } = body;

    if (!html) {
      return context.json({ error: 'Missing required field "html"' }, 400);
    }
    if (!brainRunId) {
      return context.json({ error: 'Missing required field "brainRunId"' }, 400);
    }

    // Generate slug if not provided
    if (!slug) {
      slug = generateUniqueSlug(brainRunId);
    } else {
      // Validate slug format (alphanumeric, hyphens, underscores only)
      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return context.json(
          { error: 'Slug must contain only alphanumeric characters, hyphens, and underscores' },
          400
        );
      }
    }

    const bucket = context.env.RESOURCES_BUCKET;
    const key = `pages/${slug}.html`;
    const createdAt = new Date().toISOString();

    await bucket.put(key, html, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
      customMetadata: {
        slug,
        brainRunId,
        persist: persist === true ? 'true' : 'false',
        createdAt,
        ...(ttl !== undefined && { ttl: String(ttl) }),
      },
    });

    // Register the page with MonitorDO for cleanup tracking
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    await monitorStub.registerPage(slug, brainRunId, persist === true);

    // Build the public URL for this page
    const pageUrl = `${getOrigin(context)}/pages/${slug}`;

    return context.json(
      {
        slug,
        url: pageUrl,
        brainRunId,
        persist: persist === true,
        ...(ttl !== undefined && { ttl: Number(ttl) }),
        createdAt,
      },
      201
    );
  } catch (error) {
    console.error('Error creating page:', error);
    return context.json(
      {
        error: `Failed to create page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// List all pages
pages.get('/', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  try {
    const listed = await bucket.list({ prefix: 'pages/' });

    const pageList = await Promise.all(
      listed.objects.map(async (object: R2Object) => {
        const r2Object = await bucket.head(object.key);

        if (!r2Object) {
          return null;
        }

        const metadata = r2Object.customMetadata || {};
        const slug = metadata.slug || object.key.replace('pages/', '').replace('.html', '');

        // Build the public URL
        const pageUrl = `${getOrigin(context)}/pages/${slug}`;

        return {
          slug,
          url: pageUrl,
          brainRunId: metadata.brainRunId || '',
          persist: metadata.persist === 'true',
          ...(metadata.ttl && { ttl: Number(metadata.ttl) }),
          createdAt: metadata.createdAt || object.uploaded.toISOString(),
          size: object.size,
        };
      })
    );

    // Filter out any null entries
    const validPages = pageList.filter((page) => page !== null);

    return context.json({
      pages: validPages,
      count: validPages.length,
    });
  } catch (error) {
    console.error('Error listing pages:', error);
    return context.json(
      {
        error: `Failed to list pages: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Get page metadata (without content)
pages.get('/:slug/meta', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    const r2Object = await bucket.head(key);

    if (!r2Object) {
      return context.json({ error: 'Page not found' }, 404);
    }

    const metadata = r2Object.customMetadata || {};

    return context.json({
      slug: metadata.slug || slug,
      brainRunId: metadata.brainRunId || '',
      persist: metadata.persist === 'true',
      ...(metadata.ttl && { ttl: Number(metadata.ttl) }),
      createdAt: metadata.createdAt || r2Object.uploaded.toISOString(),
      size: r2Object.size,
    });
  } catch (error) {
    console.error(`Error getting page metadata for ${slug}:`, error);
    return context.json(
      {
        error: `Failed to get page metadata: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Get page HTML content
pages.get('/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    const r2Object = await bucket.get(key);

    if (!r2Object) {
      return context.json({ error: 'Page not found' }, 404);
    }

    const html = await r2Object.text();

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error(`Error getting page ${slug}:`, error);
    return context.json(
      {
        error: `Failed to get page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Update page HTML content
pages.put('/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    // Check if page exists and get its metadata
    const existingObject = await bucket.head(key);

    if (!existingObject) {
      return context.json({ error: 'Page not found' }, 404);
    }

    const body = await context.req.json();
    const { html } = body;

    if (!html) {
      return context.json({ error: 'Missing required field "html"' }, 400);
    }

    // Preserve existing metadata
    const existingMetadata = existingObject.customMetadata || {};

    // Update with new HTML, preserving metadata
    await bucket.put(key, html, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
      customMetadata: existingMetadata,
    });

    // Build the public URL
    const pageUrl = `${getOrigin(context)}/pages/${slug}`;

    return context.json({
      slug,
      url: pageUrl,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error updating page ${slug}:`, error);
    return context.json(
      {
        error: `Failed to update page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Delete a page
pages.delete('/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    // R2 delete is idempotent - no error if object doesn't exist
    await bucket.delete(key);

    // Also remove from MonitorDO tracking
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    await monitorStub.unregisterPage(slug);

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Error deleting page ${slug}:`, error);
    return context.json(
      {
        error: `Failed to delete page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

export default pages;
