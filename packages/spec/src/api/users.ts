import type { Fetch } from './types.js';

export interface User {
  name: string;
  createdAt: number;
}

export interface UserKey {
  fingerprint: string;
  userName: string;
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

      return data.name;
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
   * Test GET /users/:name - Get a specific user
   */
  async get(fetch: Fetch, userName: string): Promise<User | null> {
    try {
      const request = new Request(`http://example.com/users/${userName}`, {
        method: 'GET',
      });

      const response = await fetch(request);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        console.error(`GET /users/${userName} returned ${response.status}`);
        return null;
      }

      const data = (await response.json()) as User;

      if (!data.name || typeof data.createdAt !== 'number') {
        console.error(`User missing required fields: ${JSON.stringify(data)}`);
        return null;
      }

      return data;
    } catch (error) {
      console.error(`Failed to test GET /users/${userName}:`, error);
      return null;
    }
  },

  /**
   * Test DELETE /users/:name - Delete a user
   */
  async delete(fetch: Fetch, userName: string): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/users/${userName}`, {
        method: 'DELETE',
      });

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /users/${userName} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to test DELETE /users/${userName}:`, error);
      return false;
    }
  },

  /**
   * Test POST /users/:name/keys - Add a key to a user
   */
  async addKey(
    fetch: Fetch,
    userName: string,
    jwk: object,
    fingerprint: string,
    label?: string
  ): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/users/${userName}/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jwk, fingerprint, label: label || '' }),
      });

      const response = await fetch(request);

      if (response.status !== 201) {
        console.error(
          `POST /users/${userName}/keys returned ${response.status}, expected 201`
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

      if (data.userName !== userName) {
        console.error(`Expected userName to be '${userName}', got ${data.userName}`);
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
      console.error(`Failed to test POST /users/${userName}/keys:`, error);
      return false;
    }
  },

  /**
   * Test GET /users/:name/keys - List keys for a user
   */
  async listKeys(fetch: Fetch, userName: string): Promise<boolean> {
    try {
      const request = new Request(`http://example.com/users/${userName}/keys`, {
        method: 'GET',
      });

      const response = await fetch(request);

      if (!response.ok) {
        console.error(`GET /users/${userName}/keys returned ${response.status}`);
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
          !key.userName ||
          typeof key.addedAt !== 'number'
        ) {
          console.error(`Key missing required fields: ${JSON.stringify(key)}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to test GET /users/${userName}/keys:`, error);
      return false;
    }
  },

  /**
   * Test DELETE /users/:name/keys/:fingerprint - Remove a key from a user
   */
  async removeKey(
    fetch: Fetch,
    userName: string,
    fingerprint: string
  ): Promise<boolean> {
    try {
      const request = new Request(
        `http://example.com/users/${userName}/keys/${encodeURIComponent(fingerprint)}`,
        {
          method: 'DELETE',
        }
      );

      const response = await fetch(request);

      if (response.status !== 204) {
        console.error(
          `DELETE /users/${userName}/keys/${fingerprint} returned ${response.status}, expected 204`
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to test DELETE /users/${userName}/keys/${fingerprint}:`,
        error
      );
      return false;
    }
  },
};
