import type { Fetch } from './types.js';

export const webhooks = {
  /**
   * Test GET /webhooks - List all available webhook handlers
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/webhooks', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /webhooks returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        webhooks: Array<{
          slug: string;
          description?: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.webhooks)) {
        console.error(
          `Expected webhooks to be an array, got ${typeof data.webhooks}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each webhook has required fields
      for (const webhook of data.webhooks) {
        if (!webhook.slug || typeof webhook.slug !== 'string') {
          console.error(
            `Webhook missing slug or has invalid type: ${JSON.stringify(
              webhook
            )}`
          );
          return false;
        }

        // Description is optional
        if (
          webhook.description !== undefined &&
          typeof webhook.description !== 'string'
        ) {
          console.error(
            `Webhook description has invalid type: ${JSON.stringify(webhook)}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /webhooks:`, error);
      return false;
    }
  },

  /**
   * Test POST /webhooks/:slug - Receive an incoming webhook from an external service
   */
  async receive(fetch: Fetch, slug: string, payload: any): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/webhooks/${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await fetch(request);

      // Accept either 200 (OK) or 202 (Accepted)
      if (response.status !== 200 && response.status !== 202) {
        console.error(
          `POST /webhooks/${slug} returned ${response.status}, expected 200 or 202`
        );
        return false;
      }

      const data = (await response.json()) as {
        received: boolean;
        action?: 'resumed' | 'started' | 'queued' | 'no-match';
      };

      // Validate response structure
      if (typeof data.received !== 'boolean') {
        console.error(
          `Expected received to be boolean, got ${typeof data.received}`
        );
        return false;
      }

      // Action field is optional
      if (
        data.action !== undefined &&
        !['resumed', 'started', 'queued', 'no-match'].includes(data.action)
      ) {
        console.error(`Invalid action value: ${data.action}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /webhooks/${slug}:`, error);
      return false;
    }
  },

  /**
   * Test POST /webhooks/:slug with non-existent webhook - Should return 404
   */
  async notFound(fetch: Fetch, slug: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/webhooks/${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      const response = await fetch(request);

      if (response.status !== 404) {
        console.error(
          `POST /webhooks/${slug} with non-existent webhook returned ${response.status}, expected 404`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error to be string, got ${typeof data.error}`);
        return false;
      }

      // Verify error message mentions the webhook slug
      if (!data.error.toLowerCase().includes('webhook')) {
        console.error(
          `Expected error message to mention webhook, got: ${data.error}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test POST /webhooks/${slug} with non-existent webhook:`,
        error
      );
      return false;
    }
  },

  /**
   * Test POST /webhooks/system/ui-form - Built-in webhook for UI form submissions.
   * This is used by pages generated via .ui() steps to submit form data.
   *
   * The endpoint:
   * - Accepts form data (application/x-www-form-urlencoded or multipart/form-data)
   * - Requires an `identifier` query parameter to match the waiting brain
   * - Requires a `__positronic_token` field for CSRF validation
   * - Returns { received: true, action: 'resumed' | 'not_found', ... }
   */
  async uiForm(
    fetch: Fetch,
    identifier: string,
    formData: Record<string, string | string[]>,
    token: string
  ): Promise<boolean> {
    try {
      // Build URLSearchParams from form data
      const params = new URLSearchParams();
      params.append('__positronic_token', token);
      for (const [key, value] of Object.entries(formData)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(`${key}[]`, v);
          }
        } else {
          params.append(key, value);
        }
      }

      const request = new Request(
        `http://example.com/webhooks/system/ui-form?identifier=${encodeURIComponent(identifier)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );

      const response = await fetch(request);

      // Accept 200 (found and processed) or 404 (no brain waiting)
      if (response.status !== 200 && response.status !== 404) {
        console.error(
          `POST /webhooks/system/ui-form returned ${response.status}, expected 200 or 404`
        );
        return false;
      }

      const data = (await response.json()) as {
        received: boolean;
        action: string;
        identifier?: string;
      };

      // Validate response structure
      if (typeof data.received !== 'boolean') {
        console.error(
          `Expected received to be boolean, got ${typeof data.received}`
        );
        return false;
      }

      if (!data.action || typeof data.action !== 'string') {
        console.error(
          `Expected action to be string, got ${typeof data.action}`
        );
        return false;
      }

      // Action should be 'resumed' or 'not_found'
      if (data.action !== 'resumed' && data.action !== 'not_found') {
        console.error(
          `Expected action to be 'resumed' or 'not_found', got '${data.action}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to test POST /webhooks/system/ui-form:', error);
      return false;
    }
  },

  /**
   * Test POST /webhooks/system/ui-form with missing identifier - Should return 400
   */
  async uiFormMissingIdentifier(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request(
        'http://example.com/webhooks/system/ui-form',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'test=data',
        }
      );

      const response = await fetch(request);

      if (response.status !== 400) {
        console.error(
          `POST /webhooks/system/ui-form without identifier returned ${response.status}, expected 400`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error to be string, got ${typeof data.error}`);
        return false;
      }

      if (!data.error.toLowerCase().includes('identifier')) {
        console.error(
          `Expected error message to mention identifier, got: ${data.error}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        'Failed to test POST /webhooks/system/ui-form without identifier:',
        error
      );
      return false;
    }
  },

  /**
   * Test POST /webhooks/system/ui-form without a CSRF token - Should return 403.
   * The endpoint checks for missing token before looking up a waiting brain.
   */
  async uiFormMissingToken(fetch: Fetch, identifier: string): Promise<boolean> {
    try {
      // Send form data without __positronic_token
      const params = new URLSearchParams();
      params.append('name', 'Test User');

      const request = new Request(
        `http://example.com/webhooks/system/ui-form?identifier=${encodeURIComponent(identifier)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );

      const response = await fetch(request);

      if (response.status !== 403) {
        console.error(
          `POST /webhooks/system/ui-form without token returned ${response.status}, expected 403`
        );
        return false;
      }

      const data = (await response.json()) as {
        received: boolean;
        action: string;
        reason?: string;
      };

      if (data.received !== false) {
        console.error(
          `Expected received to be false, got ${data.received}`
        );
        return false;
      }

      if (data.action !== 'ignored') {
        console.error(
          `Expected action to be 'ignored', got '${data.action}'`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        'Failed to test POST /webhooks/system/ui-form without token:',
        error
      );
      return false;
    }
  },

  /**
   * Test POST /webhooks/system/ui-form with a wrong CSRF token.
   * Without a brain waiting, the endpoint returns 404 (not_found) since
   * token comparison only runs after a brain is found. The key assertion
   * is that a wrong token never produces a successful 200 "resumed" response.
   */
  async uiFormWrongToken(
    fetch: Fetch,
    identifier: string,
    formData: Record<string, string | string[]>,
    wrongToken: string
  ): Promise<boolean> {
    try {
      const params = new URLSearchParams();
      params.append('__positronic_token', wrongToken);
      for (const [key, value] of Object.entries(formData)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            params.append(`${key}[]`, v);
          }
        } else {
          params.append(key, value);
        }
      }

      const request = new Request(
        `http://example.com/webhooks/system/ui-form?identifier=${encodeURIComponent(identifier)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );

      const response = await fetch(request);

      // Should NOT be 200 - wrong token must never succeed
      if (response.status === 200) {
        const data = (await response.json()) as { action?: string };
        if (data.action === 'resumed') {
          console.error(
            'POST /webhooks/system/ui-form with wrong token returned 200 with action "resumed" — token validation failed'
          );
          return false;
        }
      }

      // Accept 403 (token mismatch) or 404 (no brain waiting — token check happens after brain lookup)
      if (response.status !== 403 && response.status !== 404) {
        console.error(
          `POST /webhooks/system/ui-form with wrong token returned ${response.status}, expected 403 or 404`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        'Failed to test POST /webhooks/system/ui-form with wrong token:',
        error
      );
      return false;
    }
  },
};
