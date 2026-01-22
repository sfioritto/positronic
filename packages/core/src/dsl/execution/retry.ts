import type { RetryConfig } from '../types.js';

/**
 * Simple sleep helper that returns a promise resolving after the specified delay.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Simple semaphore for limiting concurrent operations.
 * Used internally by batch prompt execution.
 */
export class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release() {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

/**
 * Normalize retry config with defaults.
 */
export function normalizeRetryConfig(config?: RetryConfig): Required<RetryConfig> {
  return {
    maxRetries: config?.maxRetries ?? 3,
    backoff: config?.backoff ?? 'exponential',
    initialDelay: config?.initialDelay ?? 1000,
    maxDelay: config?.maxDelay ?? 30000,
  };
}

/**
 * Calculate backoff delay based on attempt number and config.
 */
export function calculateBackoff(attempt: number, config: Required<RetryConfig>) {
  switch (config.backoff) {
    case 'none':
      return config.initialDelay;
    case 'linear':
      return Math.min(config.initialDelay * (attempt + 1), config.maxDelay);
    case 'exponential':
      return Math.min(config.initialDelay * Math.pow(2, attempt), config.maxDelay);
  }
}

/**
 * Execute a function with retry and exponential backoff.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>
) {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < config.maxRetries) {
        const delay = calculateBackoff(attempt, config);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
