export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [Key in string]?: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export type State = JsonObject;

/**
 * Runtime environment information provided by the backend.
 * Contains deployment-specific values that brains need at runtime.
 */
export interface RuntimeEnv {
  /**
   * The base URL/origin of the running instance.
   * e.g., "http://localhost:3000" in development or "https://myapp.workers.dev" in production.
   */
  origin: string;
}

export type JsonPatch = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: JsonValue;
  from?: string;
}[];
