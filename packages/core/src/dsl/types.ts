import { z } from 'zod';
import type { WebhookRegistration } from './webhook.js';

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

// Loop step types

/**
 * Return type for tools that need to suspend execution and wait for an external event.
 * Supports single webhook or array of webhooks (first response wins).
 */
export interface LoopToolWaitFor {
  waitFor: WebhookRegistration<z.ZodSchema> | WebhookRegistration<z.ZodSchema>[];
}

/**
 * A tool definition for use in loop steps.
 * Compatible with Vercel AI SDK tool format, extended with Positronic-specific properties.
 */
export interface LoopTool<TInput extends z.ZodSchema = z.ZodSchema> {
  /** Description of what this tool does, helps the LLM understand when to use it */
  description: string;
  /** Zod schema defining the input parameters for this tool */
  inputSchema: TInput;
  /**
   * Execute function for the tool.
   * Can return a result directly, or { waitFor: webhook(...) } to suspend execution.
   * Not required for terminal tools.
   */
  execute?: (
    input: z.infer<TInput>
  ) => Promise<unknown | LoopToolWaitFor> | unknown | LoopToolWaitFor;
  /**
   * If true, calling this tool ends the loop.
   * The tool's input becomes the loop result (merged into state).
   */
  terminal?: boolean;
}

/**
 * Configuration for a loop step.
 */
export interface LoopConfig<
  TTools extends Record<string, LoopTool> = Record<string, LoopTool>
> {
  /** System prompt for the LLM */
  system?: string;
  /** Initial user prompt to start the conversation */
  prompt: string;
  /** Tools available to the LLM */
  tools: TTools;
  /** Safety valve - exit if cumulative tokens exceed this limit */
  maxTokens?: number;
}

/**
 * Represents a single message in the loop conversation.
 */
export interface LoopMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** For tool messages, the ID of the tool call this is responding to */
  toolCallId?: string;
  /** For tool messages, the name of the tool */
  toolName?: string;
}

/**
 * Helper type to extract the terminal tool's input type from a tools object.
 * Used for typing the result that gets merged into state.
 */
export type ExtractTerminalInput<TTools extends Record<string, LoopTool>> = {
  [K in keyof TTools]: TTools[K] extends { terminal: true; inputSchema: infer S }
    ? S extends z.ZodSchema
      ? z.infer<S>
      : never
    : never;
}[keyof TTools];
