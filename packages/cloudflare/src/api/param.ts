import type { Context } from 'hono';

/**
 * Get a route param as a non-optional string.
 * Safe because Hono only matches the route when all declared params are present.
 */
export function param(c: Context, name: string): string {
  return c.req.param(name) as string;
}
