import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { validateForm } from '../sandbox.js';

export function submitTool(
  sandbox: SandboxInstance,
  outputFieldNames?: string[],
  fakeData?: Record<string, unknown>
): StreamTool {
  return {
    description:
      'Submit the current component as the final version. If the component includes a form, it will be validated against the output schema first.',
    inputSchema: z.object({}),
    async execute() {
      if (outputFieldNames && fakeData) {
        const result = await validateForm(sandbox, outputFieldNames, fakeData);
        if (!result.success) {
          return {
            status: 'error',
            message:
              'Form validation failed. Fix the form fields and try again.',
            errors: result.errors,
          };
        }
      }
      return { status: 'success', message: 'Component submitted.' };
    },
  };
}
