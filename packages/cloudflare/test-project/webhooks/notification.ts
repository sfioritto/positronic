import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const notificationWebhook = createWebhook(
  'notification',
  z.object({
    type: z.string(),
    data: z.string(),
    timestamp: z.number(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      notificationId: string;
      type: string;
      data: string;
    };
    return {
      type: 'webhook' as const,
      identifier: body.notificationId,
      response: {
        type: body.type,
        data: body.data,
        timestamp: Date.now(),
      },
    };
  }
);

export default notificationWebhook;
