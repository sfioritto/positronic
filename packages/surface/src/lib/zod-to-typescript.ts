import type { ZodObject } from 'zod';
import { zodToTs, createTypeAlias, printNode } from 'zod-to-ts';

/**
 * Convert a Zod schema to a TypeScript type alias string.
 *
 * Uses `zod-to-ts` to produce the TypeScript AST, then prints it.
 * The result is written into the sandbox as `types.ts` for type-checking
 * LLM-generated components, and shown in the LLM prompt.
 */
export function zodToTypescript(schema: ZodObject<any>, name = 'Data'): string {
  const { node } = zodToTs(schema, name);
  const alias = createTypeAlias(node, name);
  return `export ${printNode(alias)}`;
}
