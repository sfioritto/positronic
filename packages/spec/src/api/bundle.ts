import type { Fetch } from './types.js';

/**
 * Bundle API Tests
 *
 * Tests for the /bundle/components.js and /bundle/components.css endpoints
 * which serve the page component bundle.
 *
 * NOTE: These tests only verify the API endpoint behavior. The bundle build and
 * upload process is backend-specific and must be tested separately by each
 * backend implementation.
 */
async function checkBundleFile(
  fetch: Fetch,
  file: string,
  contentType: string
): Promise<boolean> {
  try {
    const request = new Request(`http://example.com/bundle/${file}`, {
      method: 'GET',
    });

    const response = await fetch(request);

    // Bundle may or may not exist depending on project setup
    // 200 = bundle exists and served correctly
    // 404 = bundle not found (expected if no components/ directory)
    if (response.status !== 200 && response.status !== 404) {
      console.error(
        `GET /bundle/${file} returned unexpected status ${response.status}`
      );
      return false;
    }

    const actualContentType = response.headers.get('Content-Type');
    if (!actualContentType || !actualContentType.includes(contentType)) {
      console.error(
        `Expected Content-Type ${contentType}, got ${actualContentType}`
      );
      return false;
    }

    const content = await response.text();

    // If 200, verify we got some content
    if (response.status === 200 && content.length === 0) {
      console.error(`GET /bundle/${file} returned 200 but empty content`);
      return false;
    }

    // If 404, verify we got the helpful error message
    if (response.status === 404 && !content.includes('Bundle not found')) {
      console.error(
        `GET /bundle/${file} 404 response missing helpful error message`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Failed to test GET /bundle/${file}:`, error);
    return false;
  }
}

export const bundle = {
  /**
   * Test GET /bundle/components.js - Serve the component bundle script
   */
  get(fetch: Fetch): Promise<boolean> {
    return checkBundleFile(fetch, 'components.js', 'application/javascript');
  },

  /**
   * Test GET /bundle/components.css - Serve the component bundle stylesheet
   */
  getCss(fetch: Fetch): Promise<boolean> {
    return checkBundleFile(fetch, 'components.css', 'text/css');
  },
};
