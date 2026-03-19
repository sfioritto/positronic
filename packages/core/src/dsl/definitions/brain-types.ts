import { z } from 'zod';
import type { WebhookRegistration } from '../webhook.js';

/**
 * Page object available after a .ui() step.
 * Contains URL and, for form UIs, a pre-configured webhook for submissions.
 *
 * Usage:
 * ```typescript
 * .ui('Create Form', {
 *   template: ({ state }) => `Create a form for ${state.user}`,
 *   outputSchema: z.object({ name: z.string() }),
 *   stateKey: 'form' as const,
 * })
 * // form data auto-merges onto state.form
 * ```
 */
export type GeneratedPage<TSchema extends z.ZodSchema = z.ZodSchema> = {
  /** URL where the generated page can be accessed */
  url: string;
  /** Pre-configured webhook for form submissions (present when outputSchema is provided) */
  webhook?: WebhookRegistration<TSchema>;
};

/**
 * Configuration for creating a brain - either a simple string title
 * or an object with title and optional description.
 */
export type BrainConfig = string | { title: string; description?: string };
