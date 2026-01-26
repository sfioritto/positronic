import type { Fetch } from './types.js';

export const pages = {
  /**
   * Test GET /pages - List all pages
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/pages', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /pages returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        pages: Array<{
          slug: string;
          url: string;
          brainRunId: string;
          persist: boolean;
          ttl?: number;
          createdAt: string;
          size: number;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.pages)) {
        console.error(
          `Expected pages to be an array, got ${typeof data.pages}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each page has required fields
      for (const page of data.pages) {
        if (
          !page.slug ||
          typeof page.slug !== 'string' ||
          !page.url ||
          typeof page.url !== 'string' ||
          !page.brainRunId ||
          typeof page.brainRunId !== 'string' ||
          typeof page.persist !== 'boolean' ||
          !page.createdAt ||
          typeof page.createdAt !== 'string' ||
          typeof page.size !== 'number'
        ) {
          console.error(
            `Page missing required fields or has invalid types: ${JSON.stringify(
              page
            )}`
          );
          return false;
        }

        // ttl is optional
        if (page.ttl !== undefined && typeof page.ttl !== 'number') {
          console.error(`Page ttl has invalid type: ${typeof page.ttl}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /pages:`, error);
      return false;
    }
  },

  /**
   * Test POST /pages - Create a new page
   */
  async create(
    fetch: Fetch,
    slug: string,
    html: string,
    brainRunId: string,
    options?: { persist?: boolean; ttl?: number }
  ): Promise<string | null> {
    try {
      const body: {
        slug: string;
        html: string;
        brainRunId: string;
        persist?: boolean;
        ttl?: number;
      } = { slug, html, brainRunId };
      if (options?.persist !== undefined) {
        body.persist = options.persist;
      }
      if (options?.ttl !== undefined) {
        body.ttl = options.ttl;
      }

      const request = new Request('http://example.com/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(`POST /pages returned ${response.status}, expected 201`);
        return null;
      }

      const data = (await response.json()) as {
        slug: string;
        url: string;
        brainRunId: string;
        persist: boolean;
        ttl?: number;
        createdAt: string;
      };

      // Validate response structure
      if (!data.slug || typeof data.slug !== 'string') {
        console.error(`Expected slug to be string, got ${typeof data.slug}`);
        return null;
      }

      if (data.slug !== slug) {
        console.error(`Expected slug to be '${slug}', got ${data.slug}`);
        return null;
      }

      if (!data.url || typeof data.url !== 'string') {
        console.error(`Expected url to be string, got ${typeof data.url}`);
        return null;
      }

      if (!data.brainRunId || typeof data.brainRunId !== 'string') {
        console.error(
          `Expected brainRunId to be string, got ${typeof data.brainRunId}`
        );
        return null;
      }

      if (typeof data.persist !== 'boolean') {
        console.error(
          `Expected persist to be boolean, got ${typeof data.persist}`
        );
        return null;
      }

      if (!data.createdAt || typeof data.createdAt !== 'string') {
        console.error(
          `Expected createdAt to be string, got ${typeof data.createdAt}`
        );
        return null;
      }

      return data.slug;
    } catch (error) {
      console.error(`Failed to test POST /pages:`, error);
      return null;
    }
  },

  /**
   * Test GET /pages/:slug - Get page HTML content
   */
  async get(fetch: Fetch, slug: string): Promise<string | null> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        console.error(`GET /pages/${slug} returned ${response.status}`);
        return null;
      }

      // Check content type is HTML
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/html')) {
        console.error(
          `Expected content-type to be text/html, got ${contentType}`
        );
        return null;
      }

      const html = await response.text();
      return html;
    } catch (error) {
      console.error(`Failed to test GET /pages/${slug}:`, error);
      return null;
    }
  },

  /**
   * Test GET /pages/:slug/meta - Get page metadata
   */
  async getMeta(
    fetch: Fetch,
    slug: string
  ): Promise<{
    slug: string;
    brainRunId: string;
    persist: boolean;
    ttl?: number;
    createdAt: string;
    size: number;
  } | null> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}/meta`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        console.error(`GET /pages/${slug}/meta returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        slug: string;
        brainRunId: string;
        persist: boolean;
        ttl?: number;
        createdAt: string;
        size: number;
      };

      // Validate response structure
      if (
        !data.slug ||
        typeof data.slug !== 'string' ||
        !data.brainRunId ||
        typeof data.brainRunId !== 'string' ||
        typeof data.persist !== 'boolean' ||
        !data.createdAt ||
        typeof data.createdAt !== 'string' ||
        typeof data.size !== 'number'
      ) {
        console.error(
          `Page metadata missing required fields: ${JSON.stringify(data)}`
        );
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /pages/${slug}/meta:`, error);
      return null;
    }
  },

  /**
   * Test PUT /pages/:slug - Update page HTML content
   */
  async update(fetch: Fetch, slug: string, html: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ html }),
        }
      );

      const response = await fetch(request);

      if (response.status === 404) {
        console.error(`PUT /pages/${slug} returned 404 - page not found`);
        return false;
      }

      if (!response.ok) {
        console.error(`PUT /pages/${slug} returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        slug: string;
        url: string;
        updatedAt: string;
      };

      // Validate response structure
      if (!data.slug || data.slug !== slug) {
        console.error(`Expected slug to be '${slug}', got ${data.slug}`);
        return false;
      }

      if (!data.url || typeof data.url !== 'string') {
        console.error(`Expected url to be string, got ${typeof data.url}`);
        return false;
      }

      if (!data.updatedAt || typeof data.updatedAt !== 'string') {
        console.error(
          `Expected updatedAt to be string, got ${typeof data.updatedAt}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test PUT /pages/${slug}:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /pages/:slug - Delete a page
   */
  async delete(fetch: Fetch, slug: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /pages/${slug} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /pages/${slug}:`, error);
      return false;
    }
  },

  /**
   * Test GET /pages/:slug with non-existent page - Should return 404
   */
  async notFound(fetch: Fetch, slug: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/pages/${encodeURIComponent(slug)}`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `GET /pages/${slug} with non-existent page returned ${response.status}, expected 404`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /pages/${slug} with non-existent page:`,
        error
      );
      return false;
    }
  },

  /**
   * Test DELETE /pages/:slug preserves resources - deleting a page should not delete resources
   */
  async deletePreservesResources(fetch: Fetch): Promise<boolean> {
    try {
      // First create a resource
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['test content for spec'], { type: 'text/plain' }),
        'spec-test-resource.txt'
      );
      formData.append('type', 'text');
      formData.append('key', 'spec-test-resource.txt');
      formData.append('local', 'false');

      const createResourceRequest = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });

      const createResourceResponse = await fetch(createResourceRequest);
      if (createResourceResponse.status !== 201) {
        console.error(
          `Failed to create test resource: ${createResourceResponse.status}`
        );
        return false;
      }

      // Create a page to delete
      const pageSlug = `spec-test-page-${Date.now()}`;
      const createPageRequest = new Request('http://example.com/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: pageSlug,
          html: '<html><body>Test page</body></html>',
          brainRunId: 'spec-test-brain-run-id',
        }),
      });

      const createPageResponse = await fetch(createPageRequest);
      if (createPageResponse.status !== 201) {
        console.error(
          `Failed to create test page: ${createPageResponse.status}`
        );
        // Clean up resource
        await fetch(
          new Request('http://example.com/resources/spec-test-resource.txt', {
            method: 'DELETE',
          })
        );
        return false;
      }

      // Delete the page
      const deletePageRequest = new Request(
        `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
        { method: 'DELETE' }
      );

      const deletePageResponse = await fetch(deletePageRequest);
      if (deletePageResponse.status !== 204) {
        console.error(
          `DELETE /pages/${pageSlug} returned ${deletePageResponse.status}, expected 204`
        );
        // Clean up resource
        await fetch(
          new Request('http://example.com/resources/spec-test-resource.txt', {
            method: 'DELETE',
          })
        );
        return false;
      }

      // Verify the resource still exists
      const listResourcesRequest = new Request('http://example.com/resources', {
        method: 'GET',
      });

      const listResourcesResponse = await fetch(listResourcesRequest);
      if (!listResourcesResponse.ok) {
        console.error(
          `GET /resources returned ${listResourcesResponse.status}`
        );
        return false;
      }

      const resourcesData = (await listResourcesResponse.json()) as {
        resources: Array<{ key: string }>;
      };

      const resourceExists = resourcesData.resources.some(
        (r) => r.key === 'spec-test-resource.txt'
      );

      if (!resourceExists) {
        console.error(
          'DELETE /pages incorrectly deleted resources - resource not found after page delete'
        );
        return false;
      }

      // Clean up: delete the test resource
      await fetch(
        new Request('http://example.com/resources/spec-test-resource.txt', {
          method: 'DELETE',
        })
      );

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /pages preserves resources:`,
        error
      );
      return false;
    }
  },
};
