import type { PagesService, Page, PageCreateOptions } from '@positronic/core';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { MonitorDO } from './monitor-do.js';

/**
 * Generates a unique slug for pages that don't provide one.
 * Uses brainRunId prefix + random suffix for uniqueness.
 */
function generateUniqueSlug(brainRunId: string): string {
  const shortId = brainRunId.slice(0, 8);
  const random = Math.random().toString(36).substring(2, 10);
  return `page-${shortId}-${random}`;
}

/**
 * Creates a PagesService implementation that works directly with R2 and MonitorDO.
 *
 * @param brainRunId - The current brain run ID (used for page registration/cleanup)
 * @param bucket - The R2 bucket for storing pages
 * @param monitorStub - The MonitorDO stub for page registration
 * @param baseUrl - The base URL for page URLs (e.g., "https://myapp.workers.dev")
 */
export function createPagesService(
  brainRunId: string,
  bucket: R2Bucket,
  monitorStub: DurableObjectStub<MonitorDO>,
  baseUrl: string
): PagesService {
  // Implementation function that handles both overloads
  async function createPage(
    slugOrHtml: string,
    htmlOrOptions?: string | PageCreateOptions,
    maybeOptions?: PageCreateOptions
  ): Promise<Page> {
    let slug: string;
    let html: string;
    let options: PageCreateOptions | undefined;

    // Detect which overload was used:
    // - create(html, options?) - htmlOrOptions is undefined or PageCreateOptions
    // - create(slug, html, options?) - htmlOrOptions is string (the html)
    if (typeof htmlOrOptions === 'string') {
      // Called as create(slug, html, options?)
      slug = slugOrHtml;
      html = htmlOrOptions;
      options = maybeOptions;
    } else {
      // Called as create(html, options?)
      slug = generateUniqueSlug(brainRunId);
      html = slugOrHtml;
      options = htmlOrOptions;
    }

    const key = `pages/${slug}.html`;
    const createdAt = new Date().toISOString();
    const persist = options?.persist ?? false;

    // Store HTML with metadata in R2
    await bucket.put(key, html, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
      customMetadata: {
        slug,
        brainRunId,
        persist: persist ? 'true' : 'false',
        createdAt,
        ...(options?.ttl !== undefined && { ttl: String(options.ttl) }),
      },
    });

    // Register the page with MonitorDO for cleanup tracking
    await monitorStub.registerPage(slug, brainRunId, persist);

    const url = `${baseUrl}/pages/${slug}`;

    return {
      slug,
      url,
      brainRunId,
      persist,
      ...(options?.ttl !== undefined && { ttl: options.ttl }),
      createdAt,
    };
  }

  return {
    create: createPage as PagesService['create'],

    async get(slug: string): Promise<string | null> {
      const key = `pages/${slug}.html`;
      const r2Object = await bucket.get(key);

      if (!r2Object) {
        return null;
      }

      return r2Object.text();
    },

    async exists(slug: string): Promise<Page | null> {
      const key = `pages/${slug}.html`;
      const r2Object = await bucket.head(key);

      if (!r2Object) {
        return null;
      }

      const metadata = r2Object.customMetadata || {};
      const url = `${baseUrl}/pages/${slug}`;

      return {
        slug: metadata.slug || slug,
        url,
        brainRunId: metadata.brainRunId || '',
        persist: metadata.persist === 'true',
        ...(metadata.ttl && { ttl: Number(metadata.ttl) }),
        createdAt: metadata.createdAt || r2Object.uploaded.toISOString(),
      };
    },

    async update(slug: string, html: string): Promise<Page> {
      const key = `pages/${slug}.html`;

      // Check if page exists and get its metadata
      const existingObject = await bucket.head(key);

      if (!existingObject) {
        throw new Error(`Page '${slug}' not found`);
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

      const url = `${baseUrl}/pages/${slug}`;

      return {
        slug: existingMetadata.slug || slug,
        url,
        brainRunId: existingMetadata.brainRunId || '',
        persist: existingMetadata.persist === 'true',
        ...(existingMetadata.ttl && { ttl: Number(existingMetadata.ttl) }),
        createdAt: existingMetadata.createdAt || existingObject.uploaded.toISOString(),
      };
    },
  };
}
