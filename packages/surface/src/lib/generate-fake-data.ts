// Schema compatibility: we deliberately do NOT pre-validate or rewrite the
// caller's zod schema before sending it to the model. Gemini's structured-
// output accepts a strict subset of JSON Schema (no `prefixItems`/tuples,
// no `allOf`/`oneOf`/`not`, no `$ref`, no record-style `additionalProperties`,
// limited `anyOf`). When something unsupported slips in, the AI SDK surfaces
// the Google API's 400 on the first call with a path that points at the
// offending node. We prefer that fail-fast signal over an in-repo
// compatibility walker, which drifts from the API's real surface.
//
// Consequence for callers: pass a zod schema that's already compatible.
// For example, instead of `z.array(z.tuple([a, b]))` use
// `z.array(z.object({ a, b }))`.
//
// Counts on arrays: every array-of-object in the schema MUST be annotated
// with `.meta({ count: N })`. Counts are exact — the caller is expected to
// have measured them from real data. Array-of-scalar counts are optional;
// if omitted, the model picks a natural length as part of its parent's
// one-shot generation.
//
// Stopping rule for the recursive walk: when a sub-schema contains no
// meta-annotated arrays, we stop descending and ask the model for the
// whole thing in one call. Keeps fields that belong together (like
// `thread.threadId` and `thread.subject`) generated together for coherence,
// while still fanning out at every array-of-object so bulk stays tractable.

import { z, type ZodType } from 'zod';
import type { ObjectGenerator } from '@positronic/core';

function isScalar(schema: unknown): boolean {
  if (schema instanceof z.ZodObject) return false;
  if (schema instanceof z.ZodArray) return false;
  if (schema instanceof z.ZodNullable) return isScalar(schema.unwrap());
  if (schema instanceof z.ZodOptional) return isScalar(schema.unwrap());
  return true;
}

function getMetaCount(schema: unknown): number | undefined {
  if (!(schema instanceof z.ZodArray)) return undefined;
  const c = (schema.meta() as { count?: unknown } | undefined)?.count;
  return typeof c === 'number' ? c : undefined;
}

function isGenerable(schema: unknown): boolean {
  if (isScalar(schema)) return true;
  if (schema instanceof z.ZodArray) {
    // An annotated array must be its own branch so the caller's count is honored.
    if (getMetaCount(schema) !== undefined) return false;
    return isScalar(schema.element);
  }
  if (schema instanceof z.ZodObject) {
    return Object.values(schema.shape as Record<string, ZodType>).every((f) =>
      isGenerable(f)
    );
  }
  return false;
}

export async function generateFakeData<Schema extends z.ZodObject>({
  client,
  schema,
  prompt,
}: {
  client: ObjectGenerator;
  schema: Schema;
  prompt: string;
}): Promise<z.infer<Schema>> {
  const data = await generate({ client, schema, prompt });
  return schema.parse(data);
}

async function generate<InputSchema extends ZodType>({
  client,
  schema,
  prompt,
  path = '',
}: {
  client: ObjectGenerator;
  schema: InputSchema;
  prompt: string;
  path?: string;
}): Promise<z.infer<InputSchema>> {
  // Unwrap nullable/optional wrappers on non-scalar types (e.g. a nullable
  // object like `address.nullable()`). We always produce the present value
  // for fake data; schema.parse at the end accepts it under the nullable.
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return generate({
      client,
      schema: schema.unwrap() as ZodType,
      prompt,
      path,
    }) as Promise<z.infer<InputSchema>>;
  }

  if (schema instanceof z.ZodArray) {
    const count = getMetaCount(schema);

    // Array-of-object always fans out and REQUIRES a count.
    if (!isScalar(schema.element)) {
      if (count === undefined) {
        throw new Error(
          `array-of-object at \`${
            path || 'root'
          }\` requires .meta({ count: N })`
        );
      }
      const elements = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          generate({
            client,
            schema: schema.element as ZodType,
            prompt,
            path: `${path}[${i}]`,
          })
        )
      );
      return elements as z.infer<InputSchema>;
    }

    // Array-of-scalar with meta: one-shot with count in prompt. Without meta,
    // fall through so it can be absorbed into a parent one-shot via isGenerable.
    if (count !== undefined) {
      return generateWhole({ client, schema, prompt, path, count }) as Promise<
        z.infer<InputSchema>
      >;
    }
  }

  if (isGenerable(schema))
    return generateWhole({ client, schema, prompt, path });

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType>;
    const entries = await Promise.all(
      Object.entries(shape).map(async ([key, subSchema]) => {
        const value = await generate({
          client,
          schema: subSchema,
          prompt,
          path: path ? `${path}.${key}` : key,
        });
        return [key, value] as const;
      })
    );
    return Object.fromEntries(entries) as z.infer<InputSchema>;
  }

  throw new Error(`generate: unsupported schema type at ${path || 'root'}`);
}

async function generateWhole<S extends ZodType>({
  client,
  schema,
  prompt,
  path,
  count,
}: {
  client: ObjectGenerator;
  schema: S;
  prompt: string;
  path: string;
  count?: number;
}): Promise<z.infer<S>> {
  // generateObject requires an object schema. Wrap scalars/arrays in `{ value }`
  // for the call, then unwrap the result.
  const isObject = schema instanceof z.ZodObject;
  const wrapped = isObject
    ? (schema as unknown as z.ZodObject)
    : z.object({ value: schema });

  const promptLines = [`Generate realistic data for: \`${path || 'root'}\``];
  if (count !== undefined) promptLines.push(`Produce exactly ${count} items.`);

  const { object } = await client.generateObject({
    schema: wrapped,
    // `system` for the per-run-constant part so Gemini can implicit-cache it.
    system: `Domain: ${prompt}`,
    prompt: promptLines.join('\n'),
  });

  return (
    isObject ? object : (object as { value: unknown }).value
  ) as z.infer<S>;
}
