import { z } from 'zod';

// The result of calling a webhook function
export type WebhookRegistration<TSchema extends z.ZodSchema = z.ZodSchema> = {
  slug: string;
  identifier: string;
  schema: TSchema;
  token?: string;
};

// Serializable version for events (no Zod schema)
export type SerializedWebhookRegistration = {
  slug: string;
  identifier: string;
  token?: string;
};

// Serializable page reference (URL + optional webhook metadata) for persisting across resume
export type SerializedPageContext = {
  url: string;
  webhook?: SerializedWebhookRegistration;
};

// Configuration for webhooks that trigger new brain runs
export interface WebhookTriggerConfig {
  brain: string;
  runAs: string;
}

// Type for the webhook handler return value (discriminated union)
export type WebhookHandlerResult<TSchema extends z.ZodSchema = z.ZodSchema> =
  | {
      type: 'verification';
      challenge: string;
    }
  | {
      type: 'webhook';
      identifier: string;
      response: z.infer<TSchema>;
    }
  | {
      type: 'trigger';
      response: z.infer<TSchema>;
    }
  | {
      type: 'ignore';
    };

// Type for the webhook function with handler attached
export interface WebhookFunction<TSchema extends z.ZodSchema = z.ZodSchema> {
  (identifier: string, token?: string): WebhookRegistration<TSchema>;
  handler: (request: Request) => Promise<WebhookHandlerResult<TSchema>>;
  slug: string;
  schema: TSchema;
  triggers?: WebhookTriggerConfig;
}

// Factory function to create webhooks
export function createWebhook<TSchema extends z.ZodSchema>(
  slug: string,
  schema: TSchema,
  handler: (request: Request) => Promise<WebhookHandlerResult<TSchema>>,
  triggers?: WebhookTriggerConfig
): WebhookFunction<TSchema> {
  // Create the registration function
  const webhookFn = (
    identifier: string,
    token?: string
  ): WebhookRegistration<TSchema> => ({
    slug,
    identifier,
    schema,
    token,
  });

  // Attach properties to the function
  webhookFn.handler = handler;
  webhookFn.slug = slug;
  webhookFn.schema = schema;
  if (triggers) {
    webhookFn.triggers = triggers;
  }

  return webhookFn as WebhookFunction<TSchema>;
}

// Helper to extract schema type from a webhook registration
type ExtractSchema<T> = T extends { schema: infer S }
  ? S extends z.ZodSchema
    ? z.infer<S>
    : never
  : never;

/** Normalize one or many registrations and strip Zod schemas for serialization. */
export function serializeWebhookRegistrations(
  registrations: WebhookRegistration | readonly WebhookRegistration[]
): SerializedWebhookRegistration[] {
  const arr = Array.isArray(registrations) ? registrations : [registrations];
  return arr.map((r) => ({
    slug: r.slug,
    identifier: r.identifier,
    token: r.token,
  }));
}

// Helper to normalize a single WebhookRegistration into a tuple for ExtractWebhookResponses
export type NormalizeToArray<T> = T extends readonly any[] ? T : readonly [T];

// Helper type to extract the union of response types from an array of webhook registrations
export type ExtractWebhookResponses<T> = T extends readonly [...infer Items]
  ? Items[number] extends infer Item
    ? ExtractSchema<Item>
    : never
  : never;
