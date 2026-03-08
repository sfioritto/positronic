import type { JsonValue } from '../dsl/types.js';

/**
 * What createStore() returns. Holds the default values for each key.
 */
export interface StoreDefinition<T extends Record<string, JsonValue>> {
  defaults: T;
}

/**
 * Raw store provider interface.
 * Backends (R2, KV, in-memory) implement this.
 * All values are serialized as JSON.
 */
export interface StoreProvider {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/**
 * Typed store interface that brain steps receive.
 * Keys are constrained to the store definition, and values are typed.
 */
export interface TypedStore<T extends Record<string, JsonValue>> {
  get<K extends keyof T & string>(key: K): Promise<T[K]>;
  set<K extends keyof T & string>(key: K, value: T[K]): Promise<void>;
  delete<K extends keyof T & string>(key: K): Promise<void>;
  has<K extends keyof T & string>(key: K): Promise<boolean>;
}

/**
 * Conditional type that adds `store` to step params only when withStore() is used.
 * When TStore is `never` (default), this resolves to `{}` — no store in params.
 * When TStore is a record type, this adds `{ store: TypedStore<TStore> }`.
 */
export type StoreContext<TStore> = [TStore] extends [never]
  ? {}
  : TStore extends Record<string, JsonValue>
    ? { store: TypedStore<TStore> }
    : {};
