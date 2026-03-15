import type { Fetch } from './types.js';

export interface AuthSetupResponse {
  backend: string;
  rootKeyConfigured: boolean;
  instructions: string;
}

export interface WhoamiResponse {
  name: string;
  isRoot: boolean;
}

export const auth = {
  /**
   * Test GET /auth/setup - Unauthenticated endpoint returning setup instructions
   * This endpoint should be accessible without authentication
   */
  async setup(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/auth/setup', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /auth/setup returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as AuthSetupResponse;

      // Validate response structure
      if (typeof data.backend !== 'string') {
        console.error(
          `Expected backend to be string, got ${typeof data.backend}`
        );
        return false;
      }

      if (typeof data.rootKeyConfigured !== 'boolean') {
        console.error(
          `Expected rootKeyConfigured to be boolean, got ${typeof data.rootKeyConfigured}`
        );
        return false;
      }

      if (typeof data.instructions !== 'string') {
        console.error(
          `Expected instructions to be string, got ${typeof data.instructions}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /auth/setup:`, error);
      return false;
    }
  },

  /**
   * Test GET /auth/whoami - Authenticated endpoint returning current user identity
   */
  async whoami(fetch: Fetch): Promise<WhoamiResponse | null> {
    try {
      const request = new Request('http://example.com/auth/whoami', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /auth/whoami returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as WhoamiResponse;

      if (typeof data.name !== 'string') {
        console.error(`Expected name to be string, got ${typeof data.name}`);
        return null;
      }

      if (typeof data.isRoot !== 'boolean') {
        console.error(
          `Expected isRoot to be boolean, got ${typeof data.isRoot}`
        );
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /auth/whoami:`, error);
      return null;
    }
  },
};
