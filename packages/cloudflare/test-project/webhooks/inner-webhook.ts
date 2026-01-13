import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const innerWebhook = createWebhook(
  'inner-webhook',
  z.object({
    data: z.string(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      identifier: string;
      data: string;
    };
    return {
      type: 'webhook' as const,
      identifier: body.identifier,
      response: {
        data: body.data,
      },
    };
  }
);

export default innerWebhook;
