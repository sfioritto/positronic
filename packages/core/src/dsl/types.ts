import { z } from 'zod';
import type { WebhookRegistration } from './webhook.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [Key in string]?: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * State represents the shape of brain state through its execution.
 * Using `object` instead of `JsonObject` to allow TypeScript interfaces
 * (which don't have implicit index signatures) as state values.
 * The JSON patch system operates on runtime values, so the type constraint
 * is primarily for compile-time ergonomics.
 */
export type State = object;

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
export interface CurrentUser {
  name: string;
}

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

// Tool types

/**
 * Return type for tools that need to suspend execution and wait for an external event.
 * Supports single webhook or array of webhooks (first response wins).
 */
export interface ToolWaitFor {
  waitFor:
    | WebhookRegistration<z.ZodSchema>
    | WebhookRegistration<z.ZodSchema>[];
  timeout?: number;
}

/**
 * Context passed to step actions, agent config functions, and tool execute functions.
 * This is the same context available throughout brain execution.
 *
 * Generic parameters allow type-safe access to state and options.
 * For tools (which are defined statically), use the non-generic defaults.
 *
 * Ephemeral data like `response` (from webhooks) and `page` (from page steps)
 * is only available inside `.handle()` callbacks after `.wait()` and `.page()` `notify` callbacks,
 * where it's injected via intersection types.
 */
export interface StepContext<TState = object, TOptions = JsonObject> {
  /** Current brain state */
  state: TState;
  /** Brain options */
  options: TOptions;
  /** The LLM client for making AI calls */
  client: import('../clients/types.js').ObjectGenerator;
  /** Resource loader for accessing brain resources */
  resources: import('../resources/resources.js').Resources;
  /** Page service for creating pages */
  pages: import('./pages.js').PagesService;
  /** Runtime environment (origin, secrets) */
  env: RuntimeEnv;
  /** UI components available for generatePage */
  components?: Record<string, import('../ui/types.js').UIComponent<any>>;
  /** Current brain run ID (for creating unique webhook identifiers) */
  brainRunId: string;
  /** Current step ID (for creating unique webhook identifiers) */
  stepId: string;
  /** The authenticated user running this brain */
  currentUser: CurrentUser;
  /** File storage for creating, reading, and managing files */
  files: import('../files/types.js').Files;
}

/**
 * A tool definition for use in LLM tool-calling workflows.
 * Compatible with Vercel AI SDK tool format, extended with Positronic-specific properties.
 */
export interface Tool<TInput extends z.ZodSchema = z.ZodSchema> {
  /** Description of what this tool does, helps the LLM understand when to use it */
  description: string;
  /** Zod schema defining the input parameters for this tool */
  inputSchema: TInput;
  /**
   * Execute function for the tool.
   * Can return a result directly, or { waitFor: webhook(...) } to suspend execution.
   * Not required for terminal tools.
   * @param input - The validated input from the LLM
   * @param context - Runtime context with access to client, pages, state, etc.
   */
  execute?(
    input: z.infer<TInput>,
    context: StepContext
  ): Promise<unknown | ToolWaitFor> | unknown | ToolWaitFor;
  /**
   * If true, calling this tool ends the workflow.
   * The tool's input becomes the result (merged into state).
   */
  terminal?: boolean;
}

// Signal types for brain interruption

/**
 * Signal types that can be sent to a running brain.
 * Signals are processed in priority order: KILL > PAUSE > WEBHOOK_RESPONSE > RESUME
 */
export type SignalType = 'KILL' | 'PAUSE' | 'RESUME' | 'WEBHOOK_RESPONSE';

/**
 * A signal that can be injected into a running brain's execution.
 */
export type BrainSignal =
  | { type: 'KILL' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'WEBHOOK_RESPONSE'; response: JsonObject };

/**
 * Interface for providing signals to a running brain.
 * Implementations are backend-specific (in-memory, database, KV store, etc.)
 */
export interface SignalProvider {
  /**
   * Get pending signals for the current brain run.
   * Signals should be consumed (deleted) when returned.
   *
   * @param filter - 'CONTROL' returns only KILL/PAUSE, 'WEBHOOK' returns only WEBHOOK_RESPONSE, 'ALL' includes all signal types
   * @returns Array of signals in priority order (KILL first, then PAUSE, then WEBHOOK_RESPONSE, then RESUME)
   */
  getSignals(filter: 'CONTROL' | 'WEBHOOK' | 'ALL'): Promise<BrainSignal[]>;
}
