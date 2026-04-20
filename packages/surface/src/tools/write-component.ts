import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { typeCheck } from '../sandbox.js';

export function writeComponentTool(
  sandbox: SandboxInstance,
  inputSchema: string
): StreamTool {
  return {
    description:
      'Write or rewrite the full TSX component source to the sandbox and type-check it. The component is automatically type-checked against the data schema and available shadcn components. Returns type errors if any, or success.',
    inputSchema: z.object({
      source: z
        .string()
        .describe('The complete TSX source code for the component'),
    }),
    async execute({ source }: any) {
      if (/\bdata\s*:\s*(any|unknown)\b/.test(source)) {
        return {
          status: 'error',
          message:
            'Refusing to accept component: the data prop is typed as `any` or `unknown`, which bypasses schema checking. Declare `data` with the Data interface (e.g. `interface Props { data: Data }`) so the type checker can verify your field accesses match the schema.',
        };
      }
      await sandbox.writeFile('/workspace/component.tsx', source);
      const result = await typeCheck(sandbox, inputSchema);
      if (result.success) {
        return {
          status: 'success',
          message: 'Component written and type-checks successfully.',
        };
      }
      return {
        status: 'error',
        message: 'Type errors found. Fix them and call write_component again.',
        errors: result.errors,
      };
    },
  };
}
