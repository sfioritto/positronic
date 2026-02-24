import ms from 'ms';

/**
 * Parse a duration value to milliseconds.
 * Accepts a number (ms passthrough) or a string parsed by `ms` (e.g., '1h', '30m', '7d').
 * Throws on invalid input.
 */
export function parseDuration(input: number | string): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      throw new Error(`Invalid duration: ${input}. Must be a positive finite number of milliseconds.`);
    }
    return input;
  }

  let result: number | undefined;
  try {
    result = ms(input as ms.StringValue);
  } catch {
    throw new Error(`Invalid duration string: "${input}". Use formats like "30m", "1h", "24h", "7d".`);
  }
  if (result === undefined || result <= 0) {
    throw new Error(`Invalid duration string: "${input}". Use formats like "30m", "1h", "24h", "7d".`);
  }
  return result;
}
