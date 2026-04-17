import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { validateForm } from '../sandbox.js';

export function submitTool(
  sandbox: SandboxInstance,
  outputFieldNames?: string[],
  fakeData?: Record<string, unknown>,
  previewState?: { count: number }
): StreamTool {
  return {
    description:
      'Submit the current component as the final version. You MUST call preview at least once first — submit will refuse until you have. If the component includes a form, it will be validated against the output schema.',
    inputSchema: z.object({}),
    async execute() {
      if (previewState && previewState.count === 0) {
        return {
          status: 'error',
          message:
            'Cannot submit: you have not previewed the component yet. Call preview first to see how it renders, review the screenshot carefully, and only submit once the layout is polished.',
        };
      }

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
