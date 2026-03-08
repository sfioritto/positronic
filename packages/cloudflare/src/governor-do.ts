import { DurableObject } from 'cloudflare:workers';
import { parseRateLimitHeaders, getGoogleModelDefaults } from './rate-limit-headers.js';

export interface Env {
  IS_TEST?: string;
  NODE_ENV?: string;
}

export interface GovernorStats {
  rpmLimit: number | null;
  tpmLimit: number | null;
  waitQueueLength: number;
  loopRunning: boolean;
}

interface WaitQueueItem {
  estimatedTokens: number;
  resolve: () => void;
}

export class GovernorDO extends DurableObject<Env> {
  private readonly storage: SqlStorage;
  private waitQueue: WaitQueueItem[] = [];
  private loopRunning = false;
  private rpmLimit: number | null = null;
  private tpmLimit: number | null = null;
  private limitsLoaded = false;
  private lastAdmitTime = 0;
  private lastDelay = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage.sql;

    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY DEFAULT 1,
        rpm_limit INTEGER,
        tpm_limit INTEGER
      );
    `);

    this.loadLimits();
  }

  private loadLimits() {
    const rows = this.storage
      .exec(`SELECT rpm_limit, tpm_limit FROM rate_limits WHERE id = 1`)
      .toArray();

    if (rows.length > 0) {
      this.rpmLimit = rows[0].rpm_limit as number | null;
      this.tpmLimit = rows[0].tpm_limit as number | null;
      if (this.rpmLimit !== null || this.tpmLimit !== null) {
        this.limitsLoaded = true;
      }
    }
  }

  private persistLimits() {
    this.storage.exec(
      `INSERT INTO rate_limits (id, rpm_limit, tpm_limit)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rpm_limit = excluded.rpm_limit,
         tpm_limit = excluded.tpm_limit`,
      this.rpmLimit,
      this.tpmLimit
    );
  }

  async waitForCapacity(modelId: string, estimatedTokens: number): Promise<void> {
    if (!this.limitsLoaded) {
      const defaults = getGoogleModelDefaults(modelId);
      if (defaults) {
        this.rpmLimit = defaults.rpm;
        this.tpmLimit = defaults.tpm;
        this.limitsLoaded = true;
        this.persistLimits();
        console.log(`[Governor] Seeded Google defaults for "${modelId}": rpm=${defaults.rpm} tpm=${defaults.tpm}`);
      }
    }

    if (!this.limitsLoaded) {
      console.log(`[Governor] No limits known for "${modelId}" — admitting immediately`);
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push({ estimatedTokens, resolve });
      this.kickLoop();
    });
  }

  async reportHeaders(headers: Record<string, string>): Promise<void> {
    const parsed = parseRateLimitHeaders(headers);
    if (!parsed) return;

    if (parsed.requestsLimit !== null) {
      this.rpmLimit = parsed.requestsLimit;
    }
    if (parsed.tokensLimit !== null) {
      this.tpmLimit = parsed.tokensLimit;
    }

    this.persistLimits();
    this.limitsLoaded = true;
  }

  async getStats(): Promise<GovernorStats> {
    return {
      rpmLimit: this.rpmLimit,
      tpmLimit: this.tpmLimit,
      waitQueueLength: this.waitQueue.length,
      loopRunning: this.loopRunning,
    };
  }

  private kickLoop() {
    if (this.loopRunning) return;
    this.runLoop();
  }

  private async runLoop() {
    this.loopRunning = true;

    while (this.waitQueue.length > 0) {
      // Enforce delay from previous admission
      if (this.lastAdmitTime > 0 && this.lastDelay > 0) {
        const elapsed = Date.now() - this.lastAdmitTime;
        const remaining = this.lastDelay - elapsed;
        if (remaining > 0) {
          await this.sleep(remaining);
        }
      }

      const item = this.waitQueue.shift()!;
      this.lastAdmitTime = Date.now();
      this.lastDelay = this.calculateDelay(item.estimatedTokens);
      item.resolve();
    }

    this.loopRunning = false;
  }

  private calculateDelay(estimatedTokens: number): number {
    if (this.rpmLimit === null && this.tpmLimit === null) return 0;

    let tokenDelay = 0;
    let rpmDelay = 0;

    if (this.tpmLimit !== null && this.tpmLimit > 0) {
      tokenDelay = (estimatedTokens / (this.tpmLimit * 0.9)) * 60_000;
    }

    if (this.rpmLimit !== null && this.rpmLimit > 0) {
      rpmDelay = 60_000 / this.rpmLimit;
    }

    return Math.max(tokenDelay, rpmDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
