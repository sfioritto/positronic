import { DurableObject } from 'cloudflare:workers';

export interface AuthEnv {
  ROOT_PUBLIC_KEY?: string;
  NODE_ENV?: string;
}

export interface User {
  name: string;
  createdAt: number;
}

export interface UserKey {
  fingerprint: string;
  userName: string;
  jwk: string;
  label: string;
  addedAt: number;
}

export class AuthDO extends DurableObject<AuthEnv> {
  private readonly storage: SqlStorage;

  constructor(state: DurableObjectState, env: AuthEnv) {
    super(state, env);
    this.storage = state.storage.sql;

    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS users (
        name TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keys (
        fingerprint TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        jwk TEXT NOT NULL,
        label TEXT DEFAULT '',
        added_at INTEGER NOT NULL,
        FOREIGN KEY (user_name) REFERENCES users(name) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_keys_user
      ON keys(user_name);
    `);
  }

  async createUser(name: string): Promise<User> {
    const createdAt = Date.now();

    this.storage.exec(
      `INSERT INTO users (name, created_at) VALUES (?, ?)`,
      name,
      createdAt
    );

    return {
      name,
      createdAt,
    };
  }

  async getUser(name: string): Promise<User | null> {
    const results = this.storage
      .exec(`SELECT name, created_at FROM users WHERE name = ?`, name)
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      name: row.name as string,
      createdAt: row.created_at as number,
    };
  }

  async listUsers(): Promise<{ users: User[]; count: number }> {
    const users = this.storage
      .exec(`SELECT name, created_at FROM users ORDER BY created_at DESC`)
      .toArray()
      .map((row) => ({
        name: row.name as string,
        createdAt: row.created_at as number,
      }));

    return {
      users,
      count: users.length,
    };
  }

  async deleteUser(name: string): Promise<boolean> {
    const existing = await this.getUser(name);
    if (!existing) {
      return false;
    }

    // Delete associated keys first (due to foreign key)
    this.storage.exec(`DELETE FROM keys WHERE user_name = ?`, name);
    this.storage.exec(`DELETE FROM users WHERE name = ?`, name);

    return true;
  }

  async addKey(
    userName: string,
    fingerprint: string,
    jwk: string,
    label: string = ''
  ): Promise<UserKey> {
    const addedAt = Date.now();

    this.storage.exec(
      `INSERT INTO keys (fingerprint, user_name, jwk, label, added_at) VALUES (?, ?, ?, ?, ?)`,
      fingerprint,
      userName,
      jwk,
      label,
      addedAt
    );

    return {
      fingerprint,
      userName,
      jwk,
      label,
      addedAt,
    };
  }

  async listKeys(userName: string): Promise<{ keys: UserKey[]; count: number }> {
    const keys = this.storage
      .exec(
        `SELECT fingerprint, user_name, jwk, label, added_at FROM keys WHERE user_name = ? ORDER BY added_at DESC`,
        userName
      )
      .toArray()
      .map((row) => ({
        fingerprint: row.fingerprint as string,
        userName: row.user_name as string,
        jwk: row.jwk as string,
        label: row.label as string,
        addedAt: row.added_at as number,
      }));

    return {
      keys,
      count: keys.length,
    };
  }

  async removeKey(userName: string, fingerprint: string): Promise<boolean> {
    const existing = this.storage
      .exec(
        `SELECT fingerprint FROM keys WHERE fingerprint = ? AND user_name = ?`,
        fingerprint,
        userName
      )
      .toArray();

    if (existing.length === 0) {
      return false;
    }

    this.storage.exec(
      `DELETE FROM keys WHERE fingerprint = ? AND user_name = ?`,
      fingerprint,
      userName
    );

    return true;
  }

  async getKeyByFingerprint(fingerprint: string): Promise<UserKey | null> {
    const results = this.storage
      .exec(
        `SELECT fingerprint, user_name, jwk, label, added_at FROM keys WHERE fingerprint = ?`,
        fingerprint
      )
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      fingerprint: row.fingerprint as string,
      userName: row.user_name as string,
      jwk: row.jwk as string,
      label: row.label as string,
      addedAt: row.added_at as number,
    };
  }
}
