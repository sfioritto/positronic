import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const triggerWebhook = createWebhook(
  'trigger-webhook',
  z.object({
    payload: z.string(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      type?: string;
      challenge?: string;
      action?: string;
      data?: string;
    };

    // Handle verification challenge
    if (body.type === 'url_verification') {
      return {
        type: 'verification' as const,
        challenge: body.challenge!,
      };
    }

    // Ignore certain event types
    if (body.action === 'ignore') {
      return { type: 'ignore' as const };
    }

    // Trigger a new brain run
    return {
      type: 'trigger' as const,
      response: {
        payload: body.data || '',
      },
    };
  },
  { brain: 'basic-brain', runAs: 'webhook-bot' }
);

export default triggerWebhook;
