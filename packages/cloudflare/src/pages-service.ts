import type { PagesService, Page, PageCreateOptions } from '@positronic/core';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { MonitorDO } from './monitor-do.js';

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
  return {
    async create(
      slug: string,
      html: string,
      options?: PageCreateOptions
    ): Promise<Page> {
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
    },

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
