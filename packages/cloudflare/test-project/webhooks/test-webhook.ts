import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const testWebhook = createWebhook(
  'test-webhook',
  z.object({
    message: z.string(),
    userId: z.string(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      type?: string;
      challenge?: string;
      threadId?: string;
      userId?: string;
      text?: string;
      message?: string;
      user?: string;
    };

    // Handle verification challenge (for testing verification flow)
    if (body.type === 'url_verification') {
      return {
        type: 'verification' as const,
        challenge: body.challenge!,
      };
    }

    // Normal webhook handling
    return {
      type: 'webhook' as const,
      identifier: body.threadId || body.userId || '',
      response: {
        message: body.text || body.message || '',
        userId: body.user || body.userId || '',
      },
    };
  }
);

export default testWebhook;
