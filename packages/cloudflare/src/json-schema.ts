import { toJSONSchema, type ZodType } from 'zod';

/**
 * JSON Schema for a zod schema that describes what a caller or a model
 * sends: the input side, with types JSON Schema cannot express (z.date())
 * rendered as `{}` instead of throwing.
 */
export const toJsonSchema = (schema: ZodType<any>) =>
  toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
