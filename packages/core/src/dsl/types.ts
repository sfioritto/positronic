export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [Key in string]?: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export type State = JsonObject;

/**
 * Secrets/environment variables available to brains at runtime.
 * This interface is augmented via module declaration in generated secrets.d.ts
 * to provide autocomplete for project-specific secrets.
 *
 * The base interface is empty - specific keys are added by the generated secrets.d.ts
 */
export interface Secrets {
  // Augmented by generated secrets.d.ts
}

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

  /**
   * Secrets and environment variables.
   * Access via env.secrets.SECRET_NAME in brain steps.
   * Type augmentation from secrets.d.ts provides autocomplete.
   */
  secrets: Secrets;
}

export type JsonPatch = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: JsonValue;
  from?: string;
}[];
