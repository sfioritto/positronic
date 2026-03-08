import type { JsonValue } from '../dsl/types.js';
import type { StoreDefinition, StoreProvider, TypedStore } from './types.js';

/**
 * Bridge a raw StoreProvider + StoreDefinition into a TypedStore.
 * `get` returns the default value when the provider returns `undefined`.
 */
export function createTypedStore<T extends Record<string, JsonValue>>(
  provider: StoreProvider,
  definition: StoreDefinition<T>
): TypedStore<T> {
  return {
    async get<K extends keyof T & string>(key: K): Promise<T[K]> {
      const value = await provider.get(key);
      if (value === undefined) {
        return definition.defaults[key];
      }
      return value as T[K];
    },

    async set<K extends keyof T & string>(key: K, value: T[K]): Promise<void> {
      await provider.set(key, value);
    },

    async delete<K extends keyof T & string>(key: K): Promise<void> {
      await provider.delete(key);
    },

    async has<K extends keyof T & string>(key: K): Promise<boolean> {
      return provider.has(key);
    },
  };
}
