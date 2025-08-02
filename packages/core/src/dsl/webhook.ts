import { z } from 'zod';
import type { JsonObject } from './types.js';

export interface Webhook<TResponse extends JsonObject | undefined> {
  name: string;
  schema: z.ZodSchema<TResponse>;
  meta: JsonObject;
}
