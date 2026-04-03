import { z } from 'zod';
import type { StreamTool } from '@positronic/core';

export function submitTool(ctx: {
  componentSourceCode: string | null;
}): StreamTool {
  return {
    description:
      'Submit the current component as the final version. Call this when you are satisfied with the component after previewing it.',
    inputSchema: z.object({}),
    async execute() {
      if (!ctx.componentSourceCode) {
        return {
          status: 'error',
          message: 'No component written yet. Call write_component first.',
        };
      }
      return { status: 'success', message: 'Component submitted.' };
    },
  };
}
