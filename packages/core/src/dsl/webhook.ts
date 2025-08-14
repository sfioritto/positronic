import { z } from 'zod';

// The result of calling a webhook function
export type WebhookResult<TSchema extends z.ZodSchema = z.ZodSchema> = {
  slug: string;
  identifier: string;
  schema: TSchema;
};

// A webhook is a function that returns a WebhookResult
export type Webhook<TSchema extends z.ZodSchema = z.ZodSchema> = (
  identifier: string
) => WebhookResult<TSchema>;

// Helper to extract schema type from a webhook result
type ExtractSchema<T> = T extends { schema: infer S } 
  ? S extends z.ZodSchema 
    ? z.infer<S> 
    : never 
  : never;

// Helper type to extract the union of response types from an array of webhook results
export type ExtractWebhookResponses<T> = T extends readonly [...infer Items]
  ? Items[number] extends infer Item
    ? ExtractSchema<Item>
    : never
  : never;
