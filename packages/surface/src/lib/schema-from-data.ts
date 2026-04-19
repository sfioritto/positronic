import { z, type ZodType } from 'zod';

/**
 * Derive a Gemini-compatible zod schema from runtime data.
 *
 * The data is first serialized through JSON (so `toJSON()` methods run —
 * most importantly `IterateResult.toJSON()` which emits `{item, result}[]`).
 * The walker then produces a schema matching the observed shape: primitives
 * become scalar schemas, arrays get `.meta({ count: N })` stamped with their
 * actual length (required by the fake-data walker for array-of-object
 * branches), objects become `z.object` with each key walked recursively.
 *
 * No heuristics: strings stay `z.string()`, no enum/date detection,
 * no null-vs-optional distinction. The schema describes this snapshot.
 */
export function schemaFromData(
  data: unknown
): z.ZodObject<Record<string, ZodType>> {
  const json = JSON.parse(JSON.stringify(data)) as unknown;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(
      `schemaFromData: input must serialize to a plain object, got ${
        json === null ? 'null' : Array.isArray(json) ? 'array' : typeof json
      }`
    );
  }
  return walkObject(json as Record<string, unknown>);
}

function walk(value: unknown): ZodType {
  if (value === null) return z.null();
  if (typeof value === 'boolean') return z.boolean();
  if (typeof value === 'number') return z.number();
  if (typeof value === 'string') return z.string();
  if (Array.isArray(value)) return walkArray(value);
  if (typeof value === 'object') {
    return walkObject(value as Record<string, unknown>);
  }
  throw new Error(`schemaFromData: unsupported value type '${typeof value}'`);
}

function walkArray(arr: unknown[]): ZodType {
  if (arr.length === 0) {
    return z.array(z.unknown()).meta({ count: 0 });
  }
  const elementSchema = walk(arr[0]);
  return z.array(elementSchema).meta({ count: arr.length });
}

function walkObject(
  obj: Record<string, unknown>
): z.ZodObject<Record<string, ZodType>> {
  const shape: Record<string, ZodType> = {};
  for (const [key, value] of Object.entries(obj)) {
    shape[key] = walk(value);
  }
  return z.object(shape);
}
