import type { JsonValue } from '../dsl/types.js';
import type { StoreDefinition } from './types.js';

/**
 * Create a store definition with typed defaults.
 *
 * @example
 * ```typescript
 * const store = createStore({
 *   deselectedThreads: [] as string[],
 *   lastDigestDate: '',
 * });
 * ```
 */
export function createStore<T extends Record<string, JsonValue>>(
  defaults: T
): StoreDefinition<T> {
  return { defaults };
}
