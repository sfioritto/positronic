import type { Fetch } from './types.js';

/**
 * Bundle API Tests
 *
 * Tests for the /bundle/components.js endpoint which serves the component bundle.
 *
 * NOTE: These tests only verify the API endpoint behavior. The bundle build and
 * upload process is backend-specific and must be tested separately by each
 * backend implementation.
 */
export const bundle = {
  /**
   * Test GET /bundle/components.js - Serve the component bundle
   */
  async get(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/bundle/components.js', {
        method: 'GET',
      });

      const response = await fetch(request);

      // Bundle may or may not exist depending on project setup
      // 200 = bundle exists and served correctly
      // 404 = bundle not found (expected if no components/ directory)
      if (response.status !== 200 && response.status !== 404) {
        console.error(
          `GET /bundle/components.js returned unexpected status ${response.status}`
        );
        return false;
      }

      const contentType = response.headers.get('Content-Type');
      if (!contentType || !contentType.includes('application/javascript')) {
        console.error(
          `Expected Content-Type application/javascript, got ${contentType}`
        );
        return false;
      }

      // If 200, verify we got some content
      if (response.status === 200) {
        const content = await response.text();
        if (!content || content.length === 0) {
          console.error('Bundle endpoint returned 200 but empty content');
          return false;
        }
      }

      // If 404, verify we got the helpful error message
      if (response.status === 404) {
        const content = await response.text();
        if (!content.includes('Bundle not found')) {
          console.error('Bundle 404 response missing helpful error message');
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /bundle/components.js:`, error);
      return false;
    }
  },
};
