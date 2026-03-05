import { DurableObject } from 'cloudflare:workers';
import { parseRateLimitHeaders, getGoogleModelDefaults } from './rate-limit-headers.js';

export interface Env {
  IS_TEST?: string;
  NODE_ENV?: string;
}

export const LEASE_TIMEOUT_MS = 5 * 60 * 1000;
export const ALARM_INTERVAL_MS = 60 * 1000;

export interface AcquireRequest {
  requestId: string;
  clientIdentity: string;
  modelId: string;
  estimatedTokens: number;
}

export interface AcquireResult {
  granted: boolean;
  retryAfterMs?: number;
}

export interface ReleaseRequest {
  requestId: string;
  clientIdentity: string;
  actualTokens: number;
  responseHeaders?: Record<string, string>;
}

export interface RateLimitStats {
  rateLimits: Array<{
    clientIdentity: string;
    rpmLimit: number | null;
    rpmRemaining: number | null;
    rpmResetAt: number | null;
    tpmLimit: number | null;
    tpmRemaining: number | null;
    tpmResetAt: number | null;
  }>;
  activeRequestCount: number;
}

export class GovernorDO extends DurableObject<Env> {
  private readonly storage: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage.sql;

    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        client_identity TEXT PRIMARY KEY,
        rpm_limit INTEGER,
        rpm_remaining INTEGER,
        rpm_reset_at INTEGER,
        tpm_limit INTEGER,
        tpm_remaining INTEGER,
        tpm_reset_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS active_requests (
        request_id TEXT PRIMARY KEY,
        client_identity TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        acquired_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_active_requests_client
      ON active_requests(client_identity);

      CREATE INDEX IF NOT EXISTS idx_active_requests_acquired
      ON active_requests(acquired_at);
    `);
  }

  async acquire({ requestId, clientIdentity, modelId, estimatedTokens }: AcquireRequest): Promise<AcquireResult> {
    console.log(`[Governor] acquire: model="${modelId}" estimated=${estimatedTokens} identity=${clientIdentity.slice(0, 8)}…`);
    const rows = this.storage
      .exec(
        `SELECT rpm_limit, rpm_remaining, rpm_reset_at, tpm_limit, tpm_remaining, tpm_reset_at
         FROM rate_limits WHERE client_identity = ?`,
        clientIdentity
      )
      .toArray();

    const now = Date.now();

    // No row — check for hardcoded Google defaults, otherwise grant immediately
    if (rows.length === 0) {
      const googleDefaults = getGoogleModelDefaults(modelId);
      if (googleDefaults) {
        console.log(`[Governor] Seeding Google defaults for "${modelId}": rpm=${googleDefaults.requestsLimit} tpm=${googleDefaults.tokensLimit}`);
        this.storage.exec(
          `INSERT INTO rate_limits (client_identity, rpm_limit, rpm_remaining, rpm_reset_at, tpm_limit, tpm_remaining, tpm_reset_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          clientIdentity,
          googleDefaults.requestsLimit,
          googleDefaults.requestsRemaining,
          now + 60_000,
          googleDefaults.tokensLimit,
          googleDefaults.tokensRemaining,
          now + 60_000
        );
      } else {
        console.warn(`[Governor] No rate limits known for model "${modelId}" (identity: ${clientIdentity.slice(0, 8)}…) — granting without throttling`);
        this.storage.exec(
          `INSERT INTO active_requests (request_id, client_identity, estimated_tokens, acquired_at)
           VALUES (?, ?, ?, ?)`,
          requestId,
          clientIdentity,
          estimatedTokens,
          now
        );
        this.ensureAlarm();
        return { granted: true };
      }
    }

    // Read the (possibly just-seeded) row
    const row = this.storage
      .exec(
        `SELECT rpm_limit, rpm_remaining, rpm_reset_at, tpm_limit, tpm_remaining, tpm_reset_at
         FROM rate_limits WHERE client_identity = ?`,
        clientIdentity
      )
      .one()!;
    let rpmLimit = row.rpm_limit as number | null;
    let rpmRemaining = row.rpm_remaining as number | null;
    let rpmResetAt = row.rpm_reset_at as number | null;
    let tpmLimit = row.tpm_limit as number | null;
    let tpmRemaining = row.tpm_remaining as number | null;
    let tpmResetAt = row.tpm_reset_at as number | null;

    // If all limits are null, we have a row but no useful data — grant immediately
    if (rpmLimit === null && tpmLimit === null) {
      this.storage.exec(
        `INSERT INTO active_requests (request_id, client_identity, estimated_tokens, acquired_at)
         VALUES (?, ?, ?, ?)`,
        requestId,
        clientIdentity,
        estimatedTokens,
        now
      );
      this.ensureAlarm();
      return { granted: true };
    }

    // Refill buckets on-demand: if now >= reset time, restore remaining to limit
    // Set next resetAt to now+60s so buckets keep refilling even without headers (Google)
    if (rpmLimit !== null && rpmResetAt !== null && now >= rpmResetAt) {
      rpmRemaining = rpmLimit;
      rpmResetAt = now + 60_000;
    }
    if (tpmLimit !== null && tpmResetAt !== null && now >= tpmResetAt) {
      // Subtract in-flight estimated tokens from the refilled limit
      const inFlight = this.storage.exec(
        `SELECT COALESCE(SUM(estimated_tokens), 0) as total FROM active_requests WHERE client_identity = ?`,
        clientIdentity
      ).one();
      tpmRemaining = tpmLimit - (inFlight.total as number);
      tpmResetAt = now + 60_000;
    }

    // Check RPM capacity
    if (rpmLimit !== null && rpmRemaining !== null && rpmRemaining < 1) {
      const retryAfterMs = rpmResetAt !== null ? Math.max(0, rpmResetAt - now) : 60_000;
      console.log(`[Governor] DENIED (RPM exhausted): rpmRemaining=${rpmRemaining} retryAfterMs=${retryAfterMs}`);
      return { granted: false, retryAfterMs };
    }

    // Check TPM capacity
    if (tpmLimit !== null && tpmRemaining !== null && tpmRemaining < estimatedTokens) {
      const retryAfterMs = tpmResetAt !== null ? Math.max(0, tpmResetAt - now) : 60_000;
      console.log(`[Governor] DENIED (TPM exhausted): tpmRemaining=${tpmRemaining} estimated=${estimatedTokens} retryAfterMs=${retryAfterMs}`);
      return { granted: false, retryAfterMs };
    }

    // Decrement buckets
    if (rpmRemaining !== null) {
      rpmRemaining -= 1;
    }
    if (tpmRemaining !== null) {
      tpmRemaining -= estimatedTokens;
    }

    // Update rate_limits row
    this.storage.exec(
      `UPDATE rate_limits
       SET rpm_remaining = ?, rpm_reset_at = ?, tpm_remaining = ?, tpm_reset_at = ?
       WHERE client_identity = ?`,
      rpmRemaining,
      rpmResetAt,
      tpmRemaining,
      tpmResetAt,
      clientIdentity
    );

    // Track in-flight request
    this.storage.exec(
      `INSERT INTO active_requests (request_id, client_identity, estimated_tokens, acquired_at)
       VALUES (?, ?, ?, ?)`,
      requestId,
      clientIdentity,
      estimatedTokens,
      now
    );

    console.log(`[Governor] GRANTED: rpmRemaining=${rpmRemaining} tpmRemaining=${tpmRemaining}`);
    this.ensureAlarm();
    return { granted: true };
  }

  async release({ requestId, clientIdentity, actualTokens, responseHeaders }: ReleaseRequest): Promise<void> {
    // Query the estimated tokens before deleting the active request
    const activeRow = this.storage
      .exec(
        `SELECT estimated_tokens FROM active_requests WHERE request_id = ?`,
        requestId
      )
      .toArray();
    const estimatedTokens = activeRow.length > 0 ? (activeRow[0].estimated_tokens as number) : 0;

    // Remove the in-flight lease
    this.storage.exec(
      `DELETE FROM active_requests WHERE request_id = ?`,
      requestId
    );

    // Adjust TPM bucket: if actual usage differs from estimate, correct the remaining tokens
    const delta = actualTokens - estimatedTokens;
    if (delta !== 0 && estimatedTokens > 0) {
      this.storage.exec(
        `UPDATE rate_limits SET tpm_remaining = tpm_remaining - ?
         WHERE client_identity = ? AND tpm_remaining IS NOT NULL`,
        delta,
        clientIdentity
      );
    }

    // If we have response headers, parse them and upsert rate limits
    if (responseHeaders) {
      const parsed = parseRateLimitHeaders(responseHeaders);
      if (parsed) {
        this.storage.exec(
          `INSERT INTO rate_limits (client_identity, rpm_limit, rpm_remaining, rpm_reset_at, tpm_limit, tpm_remaining, tpm_reset_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_identity) DO UPDATE SET
             rpm_limit = COALESCE(excluded.rpm_limit, rate_limits.rpm_limit),
             rpm_remaining = COALESCE(excluded.rpm_remaining, rate_limits.rpm_remaining),
             rpm_reset_at = COALESCE(excluded.rpm_reset_at, rate_limits.rpm_reset_at),
             tpm_limit = COALESCE(excluded.tpm_limit, rate_limits.tpm_limit),
             tpm_remaining = COALESCE(excluded.tpm_remaining, rate_limits.tpm_remaining),
             tpm_reset_at = COALESCE(excluded.tpm_reset_at, rate_limits.tpm_reset_at)`,
          clientIdentity,
          parsed.requestsLimit,
          parsed.requestsRemaining,
          parsed.requestsResetAt,
          parsed.tokensLimit,
          parsed.tokensRemaining,
          parsed.tokensResetAt
        );
      }
    }
  }

  async cleanupStaleLeases(leaseTimeoutMs: number = LEASE_TIMEOUT_MS): Promise<void> {
    const cutoff = Date.now() - leaseTimeoutMs;

    this.storage.exec(
      `DELETE FROM active_requests WHERE acquired_at < ?`,
      cutoff
    );

    const countResult = this.storage
      .exec(`SELECT COUNT(*) as count FROM active_requests`)
      .one();
    const remaining = (countResult?.count as number) || 0;

    if (remaining > 0) {
      this.ensureAlarm();
    }
  }

  async alarm(): Promise<void> {
    await this.cleanupStaleLeases();
  }

  async getStats(): Promise<RateLimitStats> {
    const rateLimits = this.storage
      .exec(
        `SELECT client_identity, rpm_limit, rpm_remaining, rpm_reset_at,
                tpm_limit, tpm_remaining, tpm_reset_at
         FROM rate_limits`
      )
      .toArray()
      .map((row) => ({
        clientIdentity: row.client_identity as string,
        rpmLimit: row.rpm_limit as number | null,
        rpmRemaining: row.rpm_remaining as number | null,
        rpmResetAt: row.rpm_reset_at as number | null,
        tpmLimit: row.tpm_limit as number | null,
        tpmRemaining: row.tpm_remaining as number | null,
        tpmResetAt: row.tpm_reset_at as number | null,
      }));

    const countResult = this.storage
      .exec(`SELECT COUNT(*) as count FROM active_requests`)
      .one();
    const activeRequestCount = (countResult?.count as number) || 0;

    return { rateLimits, activeRequestCount };
  }

  private ensureAlarm() {
    if (this.env.IS_TEST === 'true') return;

    this.ctx.storage.getAlarm().then((alarm) => {
      if (!alarm) {
        this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    });
  }
}
