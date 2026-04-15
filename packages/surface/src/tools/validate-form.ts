import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { bundle, validateForm } from '../sandbox.js';

export function validateFormTool(
  sandbox: SandboxInstance,
  outputSchema: string,
  fakeData: Record<string, unknown>
): StreamTool {
  return {
    description:
      'Validate that the form in the component has inputs for all required fields in the output schema.',
    inputSchema: z.object({}),
    async execute() {
      // Bundle with external React for JSDOM testing
      const bundleResult = await bundle(sandbox, 'external-react');
      if (!bundleResult.success) {
        return {
          status: 'error',
          message: 'Failed to bundle.',
          errors: bundleResult.errors,
        };
      }

      const result = await validateForm(sandbox, outputSchema, fakeData);
      if (result.success) {
        return {
          status: 'success',
          message:
            'Form validation passed. All schema fields have corresponding inputs.',
        };
      }
      return {
        status: 'error',
        message: 'Form validation failed. Fix the form and try again.',
        errors: result.errors,
      };
    },
  };
}
