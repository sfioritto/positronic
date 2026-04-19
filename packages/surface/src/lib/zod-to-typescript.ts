import { z, type ZodType } from 'zod';

/**
 * Convert a Zod schema to a TypeScript type alias string (e.g.
 * `export type Data = { ... };`). Written by hand using `instanceof`
 * checks rather than TypeScript-compiler AST because the TS compiler
 * reads `__filename` at module init and breaks under V8 isolates.
 */
export function zodToTypescript(schema: z.ZodObject, name = 'Data'): string {
  return `export type ${name} = ${renderType(schema, 0)};`;
}

function renderType(schema: ZodType, depth: number): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBigInt) return 'bigint';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodDate) return 'Date';
  if (schema instanceof z.ZodSymbol) return 'symbol';
  if (schema instanceof z.ZodUndefined) return 'undefined';
  if (schema instanceof z.ZodNull) return 'null';
  if (schema instanceof z.ZodAny) return 'any';
  if (schema instanceof z.ZodUnknown) return 'unknown';
  if (schema instanceof z.ZodNever) return 'never';
  if (schema instanceof z.ZodVoid) return 'void';

  if (schema instanceof z.ZodLiteral) {
    const values = (schema as z.ZodLiteral<any>).def.values;
    return values.map((v: unknown) => JSON.stringify(v)).join(' | ');
  }
  if (schema instanceof z.ZodEnum) {
    return Object.values((schema as z.ZodEnum<any>).def.entries)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map((v) => JSON.stringify(v))
      .join(' | ');
  }

  if (schema instanceof z.ZodArray) {
    const el = (schema as z.ZodArray<any>).element as ZodType;
    return `${wrapIfUnion(renderType(el, depth), el)}[]`;
  }

  if (schema instanceof z.ZodObject) {
    return renderObject(schema as z.ZodObject, depth);
  }

  if (schema instanceof z.ZodOptional) {
    const inner = (schema as z.ZodOptional<any>).unwrap() as ZodType;
    return `${renderType(inner, depth)} | undefined`;
  }
  if (schema instanceof z.ZodNullable) {
    const inner = (schema as z.ZodNullable<any>).unwrap() as ZodType;
    return `${renderType(inner, depth)} | null`;
  }
  if (schema instanceof z.ZodDefault) {
    return renderType(
      (schema as z.ZodDefault<any>).def.innerType as ZodType,
      depth
    );
  }
  if (schema instanceof z.ZodCatch) {
    return renderType(
      (schema as z.ZodCatch<any>).def.innerType as ZodType,
      depth
    );
  }
  if (schema instanceof z.ZodPipe) {
    // Pipe's output matches its `out` schema.
    return renderType(
      (schema as z.ZodPipe<any, any>).def.out as ZodType,
      depth
    );
  }
  if (schema instanceof z.ZodLazy) {
    return renderType(
      ((schema as z.ZodLazy<any>).def.getter as () => ZodType)(),
      depth
    );
  }

  if (
    schema instanceof z.ZodUnion ||
    schema instanceof z.ZodDiscriminatedUnion
  ) {
    const opts = (schema as z.ZodUnion<any>).def.options as ZodType[];
    return opts.map((o) => renderType(o, depth)).join(' | ');
  }
  if (schema instanceof z.ZodIntersection) {
    const def = (schema as z.ZodIntersection<any, any>).def;
    return `${renderType(def.left as ZodType, depth)} & ${renderType(
      def.right as ZodType,
      depth
    )}`;
  }
  if (schema instanceof z.ZodTuple) {
    const items = (schema as z.ZodTuple<any>).def.items as ZodType[];
    return `[${items.map((i) => renderType(i, depth)).join(', ')}]`;
  }

  if (schema instanceof z.ZodRecord) {
    const def = (schema as z.ZodRecord<any, any>).def;
    const keyType = def.keyType
      ? renderType(def.keyType as ZodType, depth)
      : 'string';
    return `Record<${keyType}, ${renderType(def.valueType as ZodType, depth)}>`;
  }
  if (schema instanceof z.ZodMap) {
    const def = (schema as z.ZodMap<any, any>).def;
    return `Map<${renderType(def.keyType as ZodType, depth)}, ${renderType(
      def.valueType as ZodType,
      depth
    )}>`;
  }
  if (schema instanceof z.ZodSet) {
    return `Set<${renderType(
      (schema as z.ZodSet<any>).def.valueType as ZodType,
      depth
    )}>`;
  }

  return 'unknown';
}

function renderObject(schema: z.ZodObject, depth: number): string {
  const shape = schema.shape as Record<string, ZodType>;
  const entries = Object.entries(shape);
  if (entries.length === 0) return '{}';

  const indent = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);

  const lines = entries.map(([key, value]) => {
    const isOptional = value instanceof z.ZodOptional;
    const inner = isOptional
      ? ((value as z.ZodOptional<any>).unwrap() as ZodType)
      : value;
    return `${indent}${safeKey(key)}${isOptional ? '?' : ''}: ${renderType(
      inner,
      depth + 1
    )};`;
  });

  return `{\n${lines.join('\n')}\n${close}}`;
}

function wrapIfUnion(str: string, schema: ZodType): string {
  if (
    schema instanceof z.ZodUnion ||
    schema instanceof z.ZodDiscriminatedUnion ||
    schema instanceof z.ZodIntersection
  ) {
    return `(${str})`;
  }
  return str;
}

function safeKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
