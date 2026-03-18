import { z } from 'zod';
import type { JsonValue, CurrentUser } from '../dsl/types.js';

/**
 * Per-user field marker for store field definitions.
 * Wraps a Zod type and marks the field as per-user scoped.
 */
export interface PerUserField<T extends z.ZodType = z.ZodType> {
  type: T;
  perUser: true;
}

/**
 * Store field definitions — the shape declaration for withStore().
 * Values are either Zod types (shared) or { type: ZodType, perUser: true } (per-user).
 */
export type StoreSchema = Record<string, z.ZodType | PerUserField<any>>;

/**
 * Extract the value types from store field definitions.
 * PerUserField<T> extracts z.infer<T>, plain ZodType extracts z.infer.
 */
export type InferStoreTypes<T extends StoreSchema> = {
  [K in keyof T]: T[K] extends PerUserField<infer V>
    ? z.infer<V>
    : T[K] extends z.ZodType
    ? z.infer<T[K]>
    : never;
};

/**
 * Unified store interface — used for both raw backends AND typed stores.
 * Raw backend: Store<any> (string keys, any values)
 * Typed store: Store<{counter: number, pref: string}> (constrained keys, typed values)
 */
export interface Store<T extends Record<string, JsonValue | undefined>> {
  get<K extends keyof T & string>(key: K): Promise<T[K] | undefined>;
  set<K extends keyof T & string>(key: K, value: T[K]): Promise<void>;
  delete<K extends keyof T & string>(key: K): Promise<void>;
  has<K extends keyof T & string>(key: K): Promise<boolean>;
}

/**
 * Factory function that creates a typed Store from a schema and runtime context.
 * Backends implement this to handle persistence and key resolution.
 */
export type StoreProvider = (config: {
  schema: StoreSchema;
  brainTitle: string;
  currentUser?: CurrentUser;
}) => Store<any>;
