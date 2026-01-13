import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const loopEscalationWebhook = createWebhook(
  'loop-escalation',
  z.object({
    approved: z.boolean(),
    reviewerNote: z.string().optional(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      escalationId?: string;
      approved?: boolean;
      note?: string;
    };
    return {
      type: 'webhook' as const,
      identifier: body.escalationId || '',
      response: {
        approved: body.approved ?? false,
        reviewerNote: body.note,
      },
    };
  }
);

export default loopEscalationWebhook;
