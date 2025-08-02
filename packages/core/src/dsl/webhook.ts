import { z } from 'zod';
import type { JsonObject } from './types.js';

export interface Webhook<TResponse = any> {
  name: string;
  schema: z.ZodSchema<TResponse>;
  meta: JsonObject;
}