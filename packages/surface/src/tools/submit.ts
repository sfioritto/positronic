import { z } from 'zod';
import type { StreamTool } from '@positronic/core';

export function submitTool(): StreamTool {
  return {
    description:
      'Submit the current component as the final version. Call this when you are satisfied with the component after previewing it.',
    inputSchema: z.object({}),
    async execute() {
      return { status: 'success', message: 'Component submitted.' };
    },
  };
}
