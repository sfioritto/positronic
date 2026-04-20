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
import { zodToTypescript } from './zod-to-typescript.js';
import { governor } from './governor.js';

// Cloudflare's April 2026 relaxation moved the 6-connection cap to apply
// only to connections still waiting for headers, so 20 in-flight is safe.
// https://developers.cloudflare.com/changelog/post/2026-04-09-relaxed-connection-limiting/
const FAN_OUT_CONCURRENCY = 20;

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
  // Compose the per-walk-constant system prompt ONCE. Every leaf call in the
  // walk uses the identical system string so Gemini implicit-caches it.
  // Including the full TS schema gives each leaf call visibility into its
  // siblings and ancestors, which matters for disambiguation: a field named
  // `financialSummary` (string) sitting next to `financialEnriched` (array of
  // objects) now gets generated with awareness of both, instead of the model
  // having to guess intent from the name alone.
  const schemaTs = zodToTypescript(schema, 'Data');
  const systemPrompt = `Domain: ${prompt}

Full data schema for context:
\`\`\`typescript
${schemaTs}
\`\`\``;

  // Single AbortController shared across the entire walk. On the first leaf
  // rejection, every other in-flight fetch gets cancelled so we stop burning
  // subrequests against the model immediately. (Unhandled-rejection protection
  // is a separate concern handled by trackChild below.)
  const controller = new AbortController();
  // One governor per walk caps in-flight generateObject calls. Per-walk (not
  // module-global) so concurrent Worker invocations don't serialize against
  // each other — the cap is a per-invocation concern.
  const limit = governor(FAN_OUT_CONCURRENCY);
  try {
    const data = await generate({
      client,
      schema,
      systemPrompt,
      controller,
      limit,
    });
    return schema.parse(data);
  } finally {
    controller.abort();
  }
}

type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Wrap a child promise so its first rejection aborts all siblings sharing the
 * same controller. Attaching the catch handler also prevents the rejection
 * from being reported as unhandled — important because Promise.all only
 * awaits the first rejection, and unhandled rejections in the Worker kill
 * the invocation and replace our streamed error body with Cloudflare's
 * `internal error; reference = ...` page.
 */
function trackChild<T>(p: Promise<T>, controller: AbortController): Promise<T> {
  return p.catch((err) => {
    controller.abort();
    throw err;
  });
}

async function generate<InputSchema extends ZodType>({
  client,
  schema,
  systemPrompt,
  controller,
  limit,
  path = '',
}: {
  client: ObjectGenerator;
  schema: InputSchema;
  systemPrompt: string;
  controller: AbortController;
  limit: Limiter;
  path?: string;
}): Promise<z.infer<InputSchema>> {
  // Unwrap nullable/optional wrappers on non-scalar types (e.g. a nullable
  // object like `address.nullable()`). We always produce the present value
  // for fake data; schema.parse at the end accepts it under the nullable.
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return generate({
      client,
      schema: schema.unwrap() as ZodType,
      systemPrompt,
      controller,
      limit,
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
          trackChild(
            generate({
              client,
              schema: schema.element as ZodType,
              systemPrompt,
              controller,
              limit,
              path: `${path}[${i}]`,
            }),
            controller
          )
        )
      );
      return elements as z.infer<InputSchema>;
    }

    // Array-of-scalar with meta: one-shot with count in prompt. Without meta,
    // fall through so it can be absorbed into a parent one-shot via isGenerable.
    if (count !== undefined) {
      return generateWhole({
        client,
        schema,
        systemPrompt,
        controller,
        limit,
        path,
        count,
      }) as Promise<z.infer<InputSchema>>;
    }
  }

  if (isGenerable(schema))
    return generateWhole({
      client,
      schema,
      systemPrompt,
      controller,
      limit,
      path,
    });

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodType>;
    const entries = await Promise.all(
      Object.entries(shape).map(([key, subSchema]) =>
        trackChild(
          (async () => {
            const value = await generate({
              client,
              schema: subSchema,
              systemPrompt,
              controller,
              limit,
              path: path ? `${path}.${key}` : key,
            });
            return [key, value] as const;
          })(),
          controller
        )
      )
    );
    return Object.fromEntries(entries) as z.infer<InputSchema>;
  }

  throw new Error(`generate: unsupported schema type at ${path || 'root'}`);
}

async function generateWhole<S extends ZodType>({
  client,
  schema,
  systemPrompt,
  controller,
  limit,
  path,
  count,
}: {
  client: ObjectGenerator;
  schema: S;
  systemPrompt: string;
  controller: AbortController;
  limit: Limiter;
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

  try {
    const { object } = await limit(() =>
      client.generateObject({
        schema: wrapped,
        system: systemPrompt,
        prompt: promptLines.join('\n'),
        abortSignal: controller.signal,
      })
    );

    return (
      isObject ? object : (object as { value: unknown }).value
    ) as z.infer<S>;
  } catch (err) {
    // Wrap with the walk path in the message so the surfaced error tells us
    // which leaf actually failed. Original error is preserved via `cause`.
    throw new Error(`fake-data generation failed at \`${path || 'root'}\``, {
      cause: err,
    });
  }
}
