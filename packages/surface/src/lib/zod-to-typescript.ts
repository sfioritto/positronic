import type { ZodObject, ZodTypeAny } from 'zod';

/**
 * Convert a Zod schema to a TypeScript type alias string (e.g.
 * `export type Data = { ... };`). Written by hand to avoid shipping
 * the TypeScript compiler into a Worker bundle — `zod-to-ts` depends
 * on `typescript`, which reads `__filename` at module init and breaks
 * under V8 isolates.
 */
export function zodToTypescript(schema: ZodObject<any>, name = 'Data'): string {
  return `export type ${name} = ${renderType(schema, 0)};`;
}

function renderType(schema: ZodTypeAny, depth: number): string {
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  switch (def.typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBigInt':
      return 'bigint';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodDate':
      return 'Date';
    case 'ZodSymbol':
      return 'symbol';
    case 'ZodUndefined':
      return 'undefined';
    case 'ZodNull':
      return 'null';
    case 'ZodAny':
      return 'any';
    case 'ZodUnknown':
      return 'unknown';
    case 'ZodNever':
      return 'never';
    case 'ZodVoid':
      return 'void';
    case 'ZodLiteral':
      return JSON.stringify(def.value);
    case 'ZodEnum':
      return (def.values as string[]).map((v) => JSON.stringify(v)).join(' | ');
    case 'ZodNativeEnum':
      return Object.values(def.values as Record<string, string | number>)
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .map((v) => JSON.stringify(v))
        .join(' | ');
    case 'ZodArray':
      return `${wrapIfUnion(
        renderType(def.type as ZodTypeAny, depth),
        def.type as ZodTypeAny
      )}[]`;
    case 'ZodObject':
      return renderObject(schema as ZodObject<any>, depth);
    case 'ZodOptional':
      return `${renderType(def.innerType as ZodTypeAny, depth)} | undefined`;
    case 'ZodNullable':
      return `${renderType(def.innerType as ZodTypeAny, depth)} | null`;
    case 'ZodDefault':
      return renderType(def.innerType as ZodTypeAny, depth);
    case 'ZodEffects':
      return renderType(def.schema as ZodTypeAny, depth);
    case 'ZodBranded':
      return renderType(def.type as ZodTypeAny, depth);
    case 'ZodCatch':
      return renderType(def.innerType as ZodTypeAny, depth);
    case 'ZodPipeline':
      return renderType(def.out as ZodTypeAny, depth);
    case 'ZodLazy':
      return renderType((def.getter as () => ZodTypeAny)(), depth);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return (def.options as ZodTypeAny[])
        .map((o) => renderType(o, depth))
        .join(' | ');
    case 'ZodIntersection':
      return `${renderType(def.left as ZodTypeAny, depth)} & ${renderType(
        def.right as ZodTypeAny,
        depth
      )}`;
    case 'ZodTuple':
      return `[${(def.items as ZodTypeAny[])
        .map((i) => renderType(i, depth))
        .join(', ')}]`;
    case 'ZodRecord':
      return `Record<${
        def.keyType ? renderType(def.keyType as ZodTypeAny, depth) : 'string'
      }, ${renderType(def.valueType as ZodTypeAny, depth)}>`;
    case 'ZodMap':
      return `Map<${renderType(def.keyType as ZodTypeAny, depth)}, ${renderType(
        def.valueType as ZodTypeAny,
        depth
      )}>`;
    case 'ZodSet':
      return `Set<${renderType(def.valueType as ZodTypeAny, depth)}>`;
    default:
      return 'unknown';
  }
}

function renderObject(schema: ZodObject<any>, depth: number): string {
  const rawShape = schema._def.shape;
  const shape =
    typeof rawShape === 'function'
      ? (rawShape as () => Record<string, ZodTypeAny>)()
      : rawShape;
  const entries = Object.entries(shape as Record<string, ZodTypeAny>);
  if (entries.length === 0) return '{}';

  const indent = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);

  const lines = entries.map(([key, value]) => {
    const isOptional =
      (value._def as { typeName: string }).typeName === 'ZodOptional';
    const inner = isOptional
      ? ((value._def as { innerType: ZodTypeAny }).innerType as ZodTypeAny)
      : value;
    return `${indent}${safeKey(key)}${isOptional ? '?' : ''}: ${renderType(
      inner,
      depth + 1
    )};`;
  });

  return `{\n${lines.join('\n')}\n${close}}`;
}

function wrapIfUnion(str: string, schema: ZodTypeAny): string {
  const kind = (schema._def as { typeName: string }).typeName;
  if (
    kind === 'ZodUnion' ||
    kind === 'ZodDiscriminatedUnion' ||
    kind === 'ZodIntersection'
  ) {
    return `(${str})`;
  }
  return str;
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
