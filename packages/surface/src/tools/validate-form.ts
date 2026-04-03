import { z } from 'zod';
import type { StreamTool } from '@positronic/core';
import type { SandboxInstance } from '../sandbox.js';
import { bundle, validateForm } from '../sandbox.js';

export function validateFormTool(
  ctx: { componentSourceCode: string | null },
  sandbox: SandboxInstance,
  outputSchema: string
): StreamTool {
  return {
    description:
      'Validate that the form in the component has inputs for all required fields in the output schema. The component must be written first via write_component.',
    inputSchema: z.object({}),
    async execute() {
      if (!ctx.componentSourceCode) {
        return {
          status: 'error',
          message: 'No component written yet. Call write_component first.',
        };
      }

      // Bundle with external React for JSDOM testing
      const bundleResult = await bundle(sandbox, 'external-react');
      if (!bundleResult.success) {
        return {
          status: 'error',
          message: 'Failed to bundle.',
          errors: bundleResult.errors,
        };
      }

      const result = await validateForm(sandbox, outputSchema);
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
