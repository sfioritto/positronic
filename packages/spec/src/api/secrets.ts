import type { Fetch } from './types.js';

export const secrets = {
  /**
   * Test POST /secrets - Create or update a secret
   */
  async create(fetch: Fetch, name: string, value: string): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, value }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /secrets returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = (await response.json()) as {
        name: string;
        createdAt: string;
        updatedAt: string;
      };

      // Validate response structure
      if (!data.name || typeof data.name !== 'string') {
        console.error(`Expected name to be string, got ${typeof data.name}`);
        return false;
      }

      if (data.name !== name) {
        console.error(`Expected name to be '${name}', got ${data.name}`);
        return false;
      }

      if (typeof data.createdAt !== 'string') {
        console.error(
          `Expected createdAt to be string, got ${typeof data.createdAt}`
        );
        return false;
      }

      if (typeof data.updatedAt !== 'string') {
        console.error(
          `Expected updatedAt to be string, got ${typeof data.updatedAt}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /secrets:`, error);
      return false;
    }
  },

  /**
   * Test GET /secrets - List all secrets (names only, not values)
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /secrets returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        secrets: Array<{
          name: string;
          createdAt: string;
          updatedAt: string;
        }>;
        count: number;
      };

      // Validate response structure
      if (!Array.isArray(data.secrets)) {
        console.error(
          `Expected secrets to be an array, got ${typeof data.secrets}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each secret has required fields (but NOT the value)
      for (const secret of data.secrets) {
        if (
          !secret.name ||
          typeof secret.name !== 'string' ||
          typeof secret.createdAt !== 'string' ||
          typeof secret.updatedAt !== 'string'
        ) {
          console.error(
            `Secret missing required fields: ${JSON.stringify(secret)}`
          );
          return false;
        }

        // Ensure value is NOT included
        if ('value' in secret) {
          console.error(
            `Secret should not include value field: ${JSON.stringify(secret)}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /secrets:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /secrets/:name - Delete a specific secret
   */
  async delete(fetch: Fetch, name: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/secrets/${encodeURIComponent(name)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /secrets/${name} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /secrets/${name}:`, error);
      return false;
    }
  },

  /**
   * Test GET /secrets/:name/exists - Check if a secret exists
   */
  async exists(fetch: Fetch, name: string): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/secrets/${encodeURIComponent(name)}/exists`,
        {
          method: 'GET',
        }
      );

      const response = await fetch(request);

      if (!response.ok) {
        console.error(
          `GET /secrets/${name}/exists returned ${response.status}`
        );
        return false;
      }

      const data = (await response.json()) as { exists: boolean };

      // Validate response structure
      if (typeof data.exists !== 'boolean') {
        console.error(
          `Expected exists to be boolean, got ${typeof data.exists}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /secrets/${name}/exists:`, error);
      return false;
    }
  },

  /**
   * Test POST /secrets/bulk - Create multiple secrets
   */
  async bulk(
    fetch: Fetch,
    secrets: Array<{ name: string; value: string }>
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secrets }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /secrets/bulk returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = (await response.json()) as {
        created: number;
        updated: number;
      };

      // Validate response structure
      if (typeof data.created !== 'number') {
        console.error(
          `Expected created to be number, got ${typeof data.created}`
        );
        return false;
      }

      if (typeof data.updated !== 'number') {
        console.error(
          `Expected updated to be number, got ${typeof data.updated}`
        );
        return false;
      }

      // Total should match input
      if (data.created + data.updated !== secrets.length) {
        console.error(
          `Expected total (${
            data.created + data.updated
          }) to match input length (${secrets.length})`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /secrets/bulk:`, error);
      return false;
    }
  },

  /**
   * Test POST /secrets with ROOT_PUBLIC_KEY - Should return 403
   * ROOT_PUBLIC_KEY is a protected secret that cannot be set via the API
   */
  async createRootKeyRejected(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'ROOT_PUBLIC_KEY', value: 'test-value' }),
      });

      const response = await fetch(request);

      if (response.status !== 403) {
        console.error(
          `POST /secrets for ROOT_PUBLIC_KEY returned ${response.status}, expected 403`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error message in response`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /secrets ROOT_PUBLIC_KEY rejection:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /secrets/ROOT_PUBLIC_KEY - Should return 403
   * ROOT_PUBLIC_KEY is a protected secret that cannot be deleted via the API
   */
  async deleteRootKeyRejected(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/secrets/${encodeURIComponent('ROOT_PUBLIC_KEY')}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 403) {
        console.error(
          `DELETE /secrets/ROOT_PUBLIC_KEY returned ${response.status}, expected 403`
        );
        return false;
      }

      const data = (await response.json()) as { error: string };

      if (!data.error || typeof data.error !== 'string') {
        console.error(`Expected error message in response`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /secrets/ROOT_PUBLIC_KEY rejection:`, error);
      return false;
    }
  },

  /**
   * Test GET /secrets - Should not include ROOT_PUBLIC_KEY in list
   * ROOT_PUBLIC_KEY is filtered from the secrets list for security
   */
  async listExcludesRootKey(
    fetch: Fetch,
    hasRootKey: boolean
  ): Promise<boolean> {
    try {
      const request = new Request('http://example.com/secrets', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /secrets returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        secrets: Array<{ name: string }>;
      };

      // Check that ROOT_PUBLIC_KEY is not in the list
      const hasRootKeyInList = data.secrets.some(
        (secret) => secret.name === 'ROOT_PUBLIC_KEY'
      );

      if (hasRootKeyInList) {
        console.error(`ROOT_PUBLIC_KEY should not be included in secrets list`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /secrets excludes ROOT_PUBLIC_KEY:`, error);
      return false;
    }
  },
};
