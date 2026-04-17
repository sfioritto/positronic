import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { validateForm } from '../sandbox.js';
import type { ReviewState } from './preview.js';

export function submitTool(
  sandbox: SandboxInstance,
  outputFieldNames: string[] | undefined,
  fakeData: Record<string, unknown> | undefined,
  reviewState: ReviewState
): StreamTool {
  return {
    description:
      'Submit the current component as the final version. Requires that the most recent preview was approved by the reviewer. If the component includes a form, it will be validated against the output schema.',
    inputSchema: z.object({}),
    async execute() {
      if (!reviewState.approved) {
        return {
          status: 'error',
          message:
            'Cannot submit: the most recent preview was not approved by the reviewer. Call preview (after write_component) to get a fresh verdict.',
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
