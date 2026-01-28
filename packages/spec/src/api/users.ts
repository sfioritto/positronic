import type { Fetch } from './types.js';

export interface User {
  id: string;
  name: string;
  createdAt: number;
}

export interface UserKey {
  fingerprint: string;
  userId: string;
  label: string;
  addedAt: number;
}

export const users = {
  /**
   * Test POST /users - Create a new user
   */
  async create(fetch: Fetch, name: string): Promise<string | null> {
    try {
      const request = new Request('http://example.com/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /users returned ${response.status}, expected 201`
        );
        return null;
      }

      const data = (await response.json()) as User;

      if (!data.id || typeof data.id !== 'string') {
        console.error(`Expected id to be string, got ${typeof data.id}`);
        return null;
      }

      if (data.name !== name) {
        console.error(`Expected name to be '${name}', got ${data.name}`);
        return null;
      }

      if (typeof data.createdAt !== 'number') {
        console.error(
          `Expected createdAt to be number, got ${typeof data.createdAt}`
        );
        return null;
      }

      return data.id;
    } catch (error) {
      console.error(`Failed to test POST /users:`, error);
      return null;
    }
  },

  /**
   * Test GET /users - List all users
   */
  async list(fetch: Fetch): Promise<boolean> {
    try {
      const request = new Request('http://example.com/users', {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /users returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        users: User[];
        count: number;
      };

      if (!Array.isArray(data.users)) {
        console.error(
          `Expected users to be an array, got ${typeof data.users}`
        );
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each user has required fields
      for (const user of data.users) {
        if (
          !user.id ||
          !user.name ||
          typeof user.createdAt !== 'number'
        ) {
          console.error(
            `User missing required fields: ${JSON.stringify(user)}`
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /users:`, error);
      return false;
    }
  },

  /**
   * Test GET /users/:id - Get a specific user
   */
  async get(fetch: Fetch, userId: string): Promise<User | null> {
    try {
      const request = new Request(`http://example.com/users/${userId}`, {
        method: 'GET',
      });

      const response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        console.error(`GET /users/${userId} returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as User;

      if (!data.id || !data.name || typeof data.createdAt !== 'number') {
        console.error(`User missing required fields: ${JSON.stringify(data)}`);
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /users/${userId}:`, error);
      return null;
    }
  },

  /**
   * Test DELETE /users/:id - Delete a user
   */
  async delete(fetch: Fetch, userId: string): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/users/${userId}`, {
        method: 'DELETE',
      });

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /users/${userId} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /users/${userId}:`, error);
      return false;
    }
  },

  /**
   * Test POST /users/:id/keys - Add a key to a user
   */
  async addKey(
    fetch: Fetch,
    userId: string,
    jwk: object,
    fingerprint: string,
    label?: string
  ): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/users/${userId}/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jwk, fingerprint, label: label || '' }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /users/${userId}/keys returned ${response.status}, expected 201`
        );
        return false;
      }

      const data = (await response.json()) as UserKey;

      if (data.fingerprint !== fingerprint) {
        console.error(
          `Expected fingerprint to be '${fingerprint}', got ${data.fingerprint}`
        );
        return false;
      }

      if (data.userId !== userId) {
        console.error(`Expected userId to be '${userId}', got ${data.userId}`);
        return false;
      }

      if (typeof data.addedAt !== 'number') {
        console.error(
          `Expected addedAt to be number, got ${typeof data.addedAt}`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test POST /users/${userId}/keys:`, error);
      return false;
    }
  },

  /**
   * Test GET /users/:id/keys - List keys for a user
   */
  async listKeys(fetch: Fetch, userId: string): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/users/${userId}/keys`, {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /users/${userId}/keys returned ${response.status}`);
        return false;
      }

      const data = (await response.json()) as {
        keys: UserKey[];
        count: number;
      };

      if (!Array.isArray(data.keys)) {
        console.error(`Expected keys to be an array, got ${typeof data.keys}`);
        return false;
      }

      if (typeof data.count !== 'number') {
        console.error(`Expected count to be number, got ${typeof data.count}`);
        return false;
      }

      // Validate each key has required fields
      for (const key of data.keys) {
        if (
          !key.fingerprint ||
          !key.userId ||
          typeof key.addedAt !== 'number'
        ) {
          console.error(`Key missing required fields: ${JSON.stringify(key)}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /users/${userId}/keys:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /users/:id/keys/:fingerprint - Remove a key from a user
   */
  async removeKey(
    fetch: Fetch,
    userId: string,
    fingerprint: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/users/${userId}/keys/${encodeURIComponent(fingerprint)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /users/${userId}/keys/${fingerprint} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /users/${userId}/keys/${fingerprint}:`,
        error
      );
      return false;
    }
  },
};
