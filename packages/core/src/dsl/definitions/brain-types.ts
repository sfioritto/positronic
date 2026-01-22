import { z } from 'zod';
import type { WebhookRegistration } from '../webhook.js';

/**
 * Page object available after a .ui() step.
 * Contains URL to the page and a pre-configured webhook for form submissions.
 *
 * Usage:
 * ```typescript
 * .ui('Create Form', { template: ..., responseSchema: z.object({ name: z.string() }) })
 * .step('Notify', async ({ page, slack }) => {
 *   await slack.post(`Fill out the form: ${page.url}`);
 *   return { state, waitFor: [page.webhook] };
 * })
 * .step('Process', ({ response }) => {
 *   // response.name is typed from responseSchema
 * })
 * ```
 */
export type GeneratedPage<TSchema extends z.ZodSchema = z.ZodSchema> = {
  /** URL where the generated page can be accessed */
  url: string;
  /** Pre-configured webhook for form submissions, typed based on responseSchema */
  webhook: WebhookRegistration<TSchema>;
};

/**
 * Configuration for creating a brain - either a simple string title
 * or an object with title and optional description.
 */
export type BrainConfig = string | { title: string; description?: string };
