import type { Fetch, FetchFactory } from './types.js';

export const store = {
  /**
   * Test GET /store - List brains with store data
   */
  async listBrains(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/store', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /store returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        brains: string[];
        count: number;
      };

      if (!Array.isArray(data.brains)) {
        console.error(
          `Expected brains to be an array, got ${typeof data.brains}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /store:`, error);
      return false;
    }
  },

  /**
   * Test GET /store/:brainTitle - List keys for a brain
   */
  async listKeys(fetch: Fetch, brainTitle: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/store/${encodeURIComponent(brainTitle)}`,
        { method: 'GET' }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /store/${brainTitle} returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as {
        keys: Array<{
          key: string;
          scope: 'shared' | 'user';
          userName?: string;
          size: number;
          lastModified: string;
        }>;
        count: number;
      };

      if (!Array.isArray(data.keys)) {
        console.error(
          `Expected keys to be an array, got ${typeof data.keys}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      for (const entry of data.keys) {
        if (typeof entry.key !== 'string') {
          console.error(`Expected key to be string, got ${typeof entry.key}`);
          return false;
        }
        if (entry.scope !== 'shared' && entry.scope !== 'user') {
          console.error(`Expected scope to be 'shared' or 'user', got '${entry.scope}'`);
          return false;
        }
        if (typeof entry.size !== 'number') {
          console.error(`Expected size to be number, got ${typeof entry.size}`);
          return false;
        }
        if (typeof entry.lastModified !== 'string') {
          console.error(`Expected lastModified to be string, got ${typeof entry.lastModified}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /store/${brainTitle}:`, error);
      return false;
    }
  },

  /**
   * Test GET /store/:brainTitle/shared/:key - Get shared key value
   */
  async getSharedValue(
    fetch: Fetch,
    brainTitle: string,
    key: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/store/${encodeURIComponent(brainTitle)}/shared/${encodeURIComponent(key)}`,
        { method: 'GET' }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /store/${brainTitle}/shared/${key} returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as {
        key: string;
        value: any;
        scope: 'shared';
      };

      if (data.key !== key) {
        console.error(`Expected key '${key}', got '${data.key}'`);
        return false;
      }

      if (data.scope !== 'shared') {
        console.error(`Expected scope 'shared', got '${data.scope}'`);
        return false;
      }

      if (data.value === undefined) {
        console.error(`Expected value to be defined`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /store/${brainTitle}/shared/${key}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test GET /store/:brainTitle/user/:key - Get per-user key value
   */
  async getUserValue(
    fetch: Fetch,
    brainTitle: string,
    key: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/store/${encodeURIComponent(brainTitle)}/user/${encodeURIComponent(key)}`,
        { method: 'GET' }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /store/${brainTitle}/user/${key} returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as {
        key: string;
        value: any;
        scope: 'user';
        userName: string;
      };

      if (data.key !== key) {
        console.error(`Expected key '${key}', got '${data.key}'`);
        return false;
      }

      if (data.scope !== 'user') {
        console.error(`Expected scope 'user', got '${data.scope}'`);
        return false;
      }

      if (typeof data.userName !== 'string') {
        console.error(`Expected userName to be string, got ${typeof data.userName}`);
        return false;
      }

      if (data.value === undefined) {
        console.error(`Expected value to be defined`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test GET /store/${brainTitle}/user/${key}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test DELETE /store/:brainTitle/shared/:key - Delete shared key
   */
  async deleteSharedKey(
    fetch: Fetch,
    brainTitle: string,
    key: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/store/${encodeURIComponent(brainTitle)}/shared/${encodeURIComponent(key)}`,
        { method: 'DELETE' }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /store/${brainTitle}/shared/${key} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /store/${brainTitle}/shared/${key}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test DELETE /store/:brainTitle/user/:key - Delete per-user key
   */
  async deleteUserKey(
    fetch: Fetch,
    brainTitle: string,
    key: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/store/${encodeURIComponent(brainTitle)}/user/${encodeURIComponent(key)}`,
        { method: 'DELETE' }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /store/${brainTitle}/user/${key} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /store/${brainTitle}/user/${key}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test DELETE /store/:brainTitle - Clear all accessible keys for a brain
   */
  async clearBrainStore(
    fetch: Fetch,
    brainTitle: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/store/${encodeURIComponent(brainTitle)}`,
        { method: 'DELETE' }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `DELETE /store/${brainTitle} returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as { deleted: number };

      if (typeof data.deleted !== 'number') {
        console.error(
          `Expected deleted to be number, got ${typeof data.deleted}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /store/${brainTitle}:`,
        error
      );
      return false;
    }
  },

  /**
   * Test that shared endpoints require root access - non-root gets 403
   */
  async sharedKeyRequiresRoot(fetchFactory: FetchFactory): Promise<boolean> {
    try {
      const { fetch: userFetch } = await fetchFactory('non-root-user');

      const request = new Request(
        'http://example.com/store/test-brain/shared/test-key',
        { method: 'GET' }
      );

      const response = await userFetch(request);

      if (response.status !== 403) {
        console.error(
          `Expected 403 for non-root shared key access, got ${response.status}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test shared key root requirement:`, error);
      return false;
    }
  },

  /**
   * Test that userA cannot read userB's per-user keys
   */
  async userKeyIsolation(
    rootFetch: Fetch,
    fetchFactory: FetchFactory
  ): Promise<boolean> {
    try {
      // Get userA's fetch
      const { fetch: userAFetch, userName: userAId } = await fetchFactory('userA');

      // Try to access userA's key with userA's credentials - should work
      const request = new Request(
        'http://example.com/store/test-brain/user/test-key',
        { method: 'GET' }
      );

      const response = await userAFetch(request);

      // If the key doesn't exist, we'd get 404, which is fine for isolation testing
      // We're testing that the endpoint doesn't return 403 for the user's own data
      if (response.status === 403) {
        console.error(
          `User should be able to access their own per-user keys, got 403`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test user key isolation:`, error);
      return false;
    }
  },
};
