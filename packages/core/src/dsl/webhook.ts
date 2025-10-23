import { z } from 'zod';

// The result of calling a webhook function
export type WebhookRegistration<TSchema extends z.ZodSchema = z.ZodSchema> = {
  slug: string;
  identifier: string;
  schema: TSchema;
};

// Serializable version for events (no Zod schema)
export type SerializedWebhookRegistration = {
  slug: string;
  identifier: string;
};

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
    };

// Type for the webhook function with handler attached
export interface WebhookFunction<TSchema extends z.ZodSchema = z.ZodSchema> {
  (identifier: string): WebhookRegistration<TSchema>;
  handler: (request: Request) => Promise<WebhookHandlerResult<TSchema>>;
  slug: string;
  schema: TSchema;
}

// Factory function to create webhooks
export function createWebhook<TSchema extends z.ZodSchema>(
  slug: string,
  schema: TSchema,
  handler: (request: Request) => Promise<WebhookHandlerResult<TSchema>>
): WebhookFunction<TSchema> {
  // Create the registration function
  const webhookFn = (identifier: string): WebhookRegistration<TSchema> => ({
    slug,
    identifier,
    schema
  });
  
  // Attach properties to the function
  webhookFn.handler = handler;
  webhookFn.slug = slug;
  webhookFn.schema = schema;
  
  return webhookFn as WebhookFunction<TSchema>;
}

// Helper to extract schema type from a webhook registration
type ExtractSchema<T> = T extends { schema: infer S } 
  ? S extends z.ZodSchema 
    ? z.infer<S> 
    : never 
  : never;

// Helper type to extract the union of response types from an array of webhook registrations
export type ExtractWebhookResponses<T> = T extends readonly [...infer Items]
  ? Items[number] extends infer Item
    ? ExtractSchema<Item>
    : never
  : never;
