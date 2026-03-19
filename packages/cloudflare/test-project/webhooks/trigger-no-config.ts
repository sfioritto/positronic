import { createWebhook } from '@positronic/core';
import { z } from 'zod';

/**
 * A webhook that returns { type: 'trigger' } but has NO triggers config.
 * Used to test that the 400 guard fires when a webhook tries to trigger
 * a brain without being configured to do so.
 */
const triggerNoConfig = createWebhook(
  'trigger-no-config',
  z.object({ data: z.string() }),
  async (request: Request) => {
    const body = (await request.json()) as { data?: string };
    return {
      type: 'trigger' as const,
      response: { data: body.data || '' },
    };
  }
  // No triggers config — deliberately omitted
);

export default triggerNoConfig;
