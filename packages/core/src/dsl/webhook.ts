import { z } from 'zod';

export type Webhook<TSchema extends z.ZodSchema = z.ZodSchema> = (
  identifier: string
) => {
  slug: string;
  identifier: string;
  schema: TSchema;
};
