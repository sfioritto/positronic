import type { Fetch } from './types.js';

export interface AuthSetupResponse {
  backend: string;
  rootKeyConfigured: boolean;
  instructions: string;
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
        console.error(`Expected backend to be string, got ${typeof data.backend}`);
        return false;
      }

      if (typeof data.rootKeyConfigured !== 'boolean') {
        console.error(`Expected rootKeyConfigured to be boolean, got ${typeof data.rootKeyConfigured}`);
        return false;
      }

      if (typeof data.instructions !== 'string') {
        console.error(`Expected instructions to be string, got ${typeof data.instructions}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /auth/setup:`, error);
      return false;
    }
  },
};
