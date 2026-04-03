import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { typeCheck } from '../sandbox.js';

export function writeComponentTool(
  ctx: { componentSourceCode: string | null },
  sandbox: SandboxInstance,
  inputSchema: string,
  outputSchema?: string
): StreamTool {
  return {
    description:
      'Write or rewrite the TSX component. The component will be type-checked against the data schema and available shadcn components. Returns type errors if any, or success.',
    inputSchema: z.object({
      source: z
        .string()
        .describe('The complete TSX source code for the component'),
    }),
    async execute({ source }: any) {
      ctx.componentSourceCode = source;
      const result = await typeCheck(
        sandbox,
        source,
        inputSchema,
        outputSchema
      );
      if (result.success) {
        return {
          status: 'success',
          message: 'Component type-checks successfully.',
        };
      }
      return {
        status: 'error',
        message: 'Type errors found. Fix them and try again.',
        errors: result.errors,
      };
    },
  };
}
