import { DurableObject } from 'cloudflare:workers';
import { v4 as uuidv4 } from 'uuid';

export interface AuthEnv {
  ROOT_PUBLIC_KEY?: string;
  NODE_ENV?: string;
}

export interface User {
  id: string;
  name: string;
  createdAt: number;
}

export interface UserKey {
  fingerprint: string;
  userId: string;
  jwk: string;
  label: string;
  addedAt: number;
}

export class AuthDO extends DurableObject<AuthEnv> {
  private readonly storage: SqlStorage;

  constructor(state: DurableObjectState, env: AuthEnv) {
    super(state, env);
    this.storage = state.storage.sql;

    // Initialize database schema
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keys (
        fingerprint TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        jwk TEXT NOT NULL,
        label TEXT DEFAULT '',
        added_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_keys_user
      ON keys(user_id);
    `);
  }

  async createUser(name: string): Promise<User> {
    const id = uuidv4();
    const createdAt = Date.now();

    this.storage.exec(
      `INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)`,
      id,
      name,
      createdAt
    );

    return {
      id,
      name,
      createdAt,
    };
  }

  async getUser(userId: string): Promise<User | null> {
    const results = this.storage
      .exec(`SELECT id, name, created_at FROM users WHERE id = ?`, userId)
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as number,
    };
  }

  async getUserByName(name: string): Promise<User | null> {
    const results = this.storage
      .exec(`SELECT id, name, created_at FROM users WHERE name = ?`, name)
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as number,
    };
  }

  async listUsers(): Promise<{ users: User[]; count: number }> {
    const users = this.storage
      .exec(`SELECT id, name, created_at FROM users ORDER BY created_at DESC`)
      .toArray()
      .map((row) => ({
        id: row.id as string,
        name: row.name as string,
        createdAt: row.created_at as number,
      }));

    return {
      users,
      count: users.length,
    };
  }

  async deleteUser(userId: string): Promise<boolean> {
    const existing = await this.getUser(userId);
    if (!existing) {
      return false;
    }

    // Delete associated keys first (due to foreign key)
    this.storage.exec(`DELETE FROM keys WHERE user_id = ?`, userId);
    this.storage.exec(`DELETE FROM users WHERE id = ?`, userId);

    return true;
  }

  async addKey(
    userId: string,
    fingerprint: string,
    jwk: string,
    label: string = ''
  ): Promise<UserKey> {
    const addedAt = Date.now();

    this.storage.exec(
      `INSERT INTO keys (fingerprint, user_id, jwk, label, added_at) VALUES (?, ?, ?, ?, ?)`,
      fingerprint,
      userId,
      jwk,
      label,
      addedAt
    );

    return {
      fingerprint,
      userId,
      jwk,
      label,
      addedAt,
    };
  }

  async listKeys(userId: string): Promise<{ keys: UserKey[]; count: number }> {
    const keys = this.storage
      .exec(
        `SELECT fingerprint, user_id, jwk, label, added_at FROM keys WHERE user_id = ? ORDER BY added_at DESC`,
        userId
      )
      .toArray()
      .map((row) => ({
        fingerprint: row.fingerprint as string,
        userId: row.user_id as string,
        jwk: row.jwk as string,
        label: row.label as string,
        addedAt: row.added_at as number,
      }));

    return {
      keys,
      count: keys.length,
    };
  }

  async removeKey(userId: string, fingerprint: string): Promise<boolean> {
    const existing = this.storage
      .exec(
        `SELECT fingerprint FROM keys WHERE fingerprint = ? AND user_id = ?`,
        fingerprint,
        userId
      )
      .toArray();

    if (existing.length === 0) {
      return false;
    }

    this.storage.exec(
      `DELETE FROM keys WHERE fingerprint = ? AND user_id = ?`,
      fingerprint,
      userId
    );

    return true;
  }

  async getKeyByFingerprint(fingerprint: string): Promise<UserKey | null> {
    const results = this.storage
      .exec(
        `SELECT fingerprint, user_id, jwk, label, added_at FROM keys WHERE fingerprint = ?`,
        fingerprint
      )
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      fingerprint: row.fingerprint as string,
      userId: row.user_id as string,
      jwk: row.jwk as string,
      label: row.label as string,
      addedAt: row.added_at as number,
    };
  }
}
