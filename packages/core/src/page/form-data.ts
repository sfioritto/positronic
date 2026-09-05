import type { z } from 'zod';

/**
 * Parse form data into a plain object, handling array fields.
 * Supports:
 * - name[] syntax for explicit arrays
 * - Multiple values with same key (converted to array)
 */
export function parseFormData(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    // Handle array fields (e.g., name[] for multi-select)
    if (key.endsWith('[]')) {
      const baseKey = key.slice(0, -2);
      if (!result[baseKey]) {
        result[baseKey] = [];
      }
      (result[baseKey] as unknown[]).push(value);
    } else if (result[key] !== undefined) {
      // Convert to array if same key appears multiple times
      if (!Array.isArray(result[key])) {
        result[key] = [result[key]];
      }
      (result[key] as unknown[]).push(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Inspect _zod.def.type instead of using instanceof: brain bundles carry
// their own copy of zod, so schema instances that cross a bundle boundary
// fail instanceof checks against this module's zod classes.
function schemaType(schema: z.ZodTypeAny): string | undefined {
  return (schema as any)?._zod?.def?.type;
}

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'catch',
  'readonly',
  'nonoptional',
]);

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: any = schema;
  while (true) {
    const type = schemaType(current);
    if (type !== undefined && WRAPPERS.has(type)) {
      current = current._zod.def.innerType;
    } else if (type === 'pipe') {
      // .transform() pipes the schema into a transform; z.preprocess() pipes
      // a transform into the schema. Follow whichever side is the schema.
      const { in: input, out: output } = current._zod.def;
      current = schemaType(input) === 'transform' ? output : input;
    } else {
      return current;
    }
  }
}

/**
 * Coerce a parsed form response to match the form schema's array fields.
 *
 * HTML form encoding can't distinguish "an array with one element" from a
 * scalar — a single checked checkbox or a lone input submits one value — and
 * omits the field entirely when nothing is selected. When the schema expects
 * an array, wrap lone scalars and default missing required fields to [].
 */
export function coerceFormResponse(
  formSchema: z.ZodObject<any>,
  response: Record<string, unknown>
): Record<string, unknown> {
  const coerced = { ...response };

  for (const [key, fieldSchema] of Object.entries<z.ZodTypeAny>(
    formSchema.shape
  )) {
    if (schemaType(unwrapSchema(fieldSchema)) !== 'array') continue;

    const value = coerced[key];
    if (value === undefined) {
      // .default() makes isOptional() true, so ask zod what undefined parses
      // to; never assign undefined back — it clobbers state on spread.
      const parsed = fieldSchema.safeParse(undefined);
      if (!parsed.success) {
        coerced[key] = [];
      } else if (parsed.data !== undefined) {
        coerced[key] = parsed.data;
      }
    } else if (!Array.isArray(value)) {
      coerced[key] = [value];
    }
  }

  return coerced;
}
