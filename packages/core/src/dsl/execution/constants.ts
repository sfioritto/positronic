import type { RuntimeEnv } from '../types.js';

/**
 * Default runtime environment used when env is not provided.
 * This ensures backward compatibility with existing code.
 */
export const DEFAULT_ENV: RuntimeEnv = {
  origin: 'http://localhost:8787',
  secrets: {},
};
