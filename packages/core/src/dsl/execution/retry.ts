/**
 * Simple sleep helper that returns a promise resolving after the specified delay.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
