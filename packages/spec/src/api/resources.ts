import type { Fetch } from './types.js';

export const resources = {
  /**
   * Test GET /resources - List all resources
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/resources', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /resources returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        resources: Array<{
          key: string;
          type: string;
          size: number;
          lastModified: string;
          local: boolean;
        }>;
        truncated: boolean;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.resources)) {
        console.error(
          `Expected resources to be an array, got ${typeof data.resources}`
        );
        return false;
      }

      if (typeof data.truncated !== 'boolean') {
        console.error(
          `Expected truncated to be boolean, got ${typeof data.truncated}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each resource has required fields
      for (const resource of data.resources) {
        if (
          !resource.key ||
          !resource.type ||
          typeof resource.size !== 'number' ||
          !resource.lastModified ||
          typeof resource.local !== 'boolean'
        ) {
          console.error(
            `Resource missing required fields: ${JSON.stringify(resource)}`
          );
          return false;
        }

        if (!['text', 'binary'].includes(resource.type)) {
          console.error(`Invalid resource type: ${resource.type}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /resources:`, error);
      return false;
    }
  },

  /**
   * Test POST /resources - Upload a resource
   */
  async upload(fetch: Fetch): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob(['test content'], { type: 'text/plain' }),
        'test.txt'
      );
      formData.append('type', 'text');
      formData.append('key', 'test-resource.txt');
      formData.append('local', 'false');

      const request = new Request('http://example.com/resources', {
        method: 'POST',
        body: formData,
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /resources returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = (await response.json()) as {
        key: string;
        type: string;
        size: number;
        lastModified: string;
        local: boolean;
      };

      // Validate response has required fields
      if (
        !data.key ||
        !data.type ||
        typeof data.size !== 'number' ||
        !data.lastModified ||
        typeof data.local !== 'boolean'
      ) {
        console.error(
          `Response missing required fields: ${JSON.stringify(data)}`
        );
        return false;
      }

      if (data.key !== 'test-resource.txt') {
        console.error(
          `Expected key to be 'test-resource.txt', got ${data.key}`
        );
        return false;
      }

      if (data.type !== 'text') {
        console.error(`Expected type to be 'text', got ${data.type}`);
        return false;
      }

      if (data.local !== false) {
        console.error(`Expected local to be false, got ${data.local}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /resources:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /resources/:key - Delete a specific resource
   */
  async delete(fetch: Fetch, key: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/resources/${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /resources/${key} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /resources/${key}:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /resources - Bulk delete all resources (dev mode only)
   */
  async deleteAll(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/resources', {
        method: 'DELETE',
      });

      const response = await fetch(request);

      // In production mode, this should return 403
      if (response.status === 403) {
        const data = (await response.json()) as { error: string };
        if (
          data.error === 'Bulk delete is only available in development mode'
        ) {
          // This is expected behavior in production
          return true;
        }
      }

      if (response.status !== 200) {
        console.error(
          `DELETE /resources returned ${response.status}, expected 200 or 403`
        );
        return false;
      }

      const data = (await response.json()) as { deletedCount: number };

      if (typeof data.deletedCount !== 'number') {
        console.error(
          `Expected deletedCount to be number, got ${typeof data.deletedCount}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /resources:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /resources preserves pages - bulk delete should not delete pages
   */
  async deleteAllPreservesPages(fetch: Fetch): Promise<boolean> {
    try {
      // First create a page
      const pageSlug = `spec-test-page-${Date.now()}`;
      const pageHtml = '<html><body>Test page for spec</body></html>';
      const brainRunId = 'spec-test-brain-run-id';

      const createPageRequest = new Request('http://example.com/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: pageSlug,
          html: pageHtml,
          brainRunId,
        }),
      });

      const createPageResponse = await fetch(createPageRequest);
      if (createPageResponse.status !== 201) {
        console.error(
          `Failed to create test page: ${createPageResponse.status}`
        );
        return false;
      }

      // Now bulk delete all resources
      const deleteRequest = new Request('http://example.com/resources', {
        method: 'DELETE',
      });

      const deleteResponse = await fetch(deleteRequest);

      // Skip test if in production mode (403)
      if (deleteResponse.status === 403) {
        // Clean up the page we created
        await fetch(
          new Request(
            `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
            { method: 'DELETE' }
          )
        );
        console.log(
          'Skipping deleteAllPreservesPages test - bulk delete not available in production'
        );
        return true;
      }

      if (deleteResponse.status !== 200) {
        console.error(
          `DELETE /resources returned ${deleteResponse.status}, expected 200`
        );
        return false;
      }

      // Verify the page still exists
      const getPageRequest = new Request(
        `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
        { method: 'GET' }
      );

      const getPageResponse = await fetch(getPageRequest);

      if (getPageResponse.status === 404) {
        console.error(
          'DELETE /resources incorrectly deleted pages - page not found after bulk delete'
        );
        return false;
      }

      if (!getPageResponse.ok) {
        console.error(
          `GET /pages/${pageSlug} returned ${getPageResponse.status}`
        );
        return false;
      }

      // Clean up: delete the test page
      await fetch(
        new Request(
          `http://example.com/pages/${encodeURIComponent(pageSlug)}`,
          { method: 'DELETE' }
        )
      );

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /resources preserves pages:`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /resources/presigned-link - Generate presigned URL for upload
   */
  async generatePresignedLink(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request(
        'http://example.com/resources/presigned-link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: 'test-files/large-video.mp4',
            type: 'binary',
            size: 150 * 1024 * 1024, // 150MB - larger than Worker limit
          }),
        }
      );

      const response = await fetch(request);

      // If credentials are not configured, expect 400
      if (response.status === 400) {
        const data = (await response.json()) as { error?: string };
        // This is acceptable - implementation may not have credentials configured
        console.log(
          'Presigned URL generation not available - this is acceptable'
        );
        return true;
      }

      if (response.status !== 200) {
        console.error(
          `POST /resources/presigned-link returned ${response.status}, expected 200 or 400`
        );
        return false;
      }

      const data = (await response.json()) as {
        url: string;
        method: string;
        expiresIn: number;
      };

      // Validate response structure (backend-agnostic)
      if (!data.url || typeof data.url !== 'string') {
        console.error(`Expected url to be string, got ${typeof data.url}`);
        return false;
      }

      if (!data.method || data.method !== 'PUT') {
        console.error(`Expected method to be 'PUT', got ${data.method}`);
        return false;
      }

      if (typeof data.expiresIn !== 'number' || data.expiresIn <= 0) {
        console.error(
          `Expected expiresIn to be positive number, got ${data.expiresIn}`
        );
        return false;
      }

      // Basic URL validation - just ensure it's a valid URL
      try {
        new URL(data.url);
        console.log('Presigned URL structure validated successfully');
      } catch (error) {
        console.error(`Invalid URL returned: ${data.url}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /resources/presigned-link:`, error);
      return false;
    }
  },
};
