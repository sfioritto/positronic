import { brain } from './brain.js';
import { z } from 'zod';
import { createWebhook } from './webhook.js';

// Example webhooks using createWebhook factory
export const slackWebhook = createWebhook(
  'slack',
  z.object({
    message: z.string(),
    threadId: z.string(),
  }),
  async (request) => {
    const body = await request.json() as any;
    return {
      type: 'webhook' as const,
      identifier: body.thread_ts,
      response: {
        message: body.text,
        threadId: body.thread_ts,
      }
    };
  }
);

export const emailWebhook = createWebhook(
  'email',
  z.object({
    subject: z.string(),
    body: z.string(),
    from: z.string(),
  }),
  async (request) => {
    const body = await request.json() as any;
    return {
      type: 'webhook' as const,
      identifier: body.messageId,
      response: {
        subject: body.subject,
        body: body.body,
        from: body.from,
      }
    };
  }
);

const myBrain = brain('My Brain')
  .step('My Step', ({ state }) => {
    return { cool: 'thing', ...state };
  })
  .wait('Wait for response', () => [slackWebhook('thread-123'), emailWebhook('email-456')])
  .step('My Step 2', ({ state, response }) => {
    if (response) {
      if ('threadId' in response) {
        // Handle Slack webhook response
        return { ...state, slackMessage: 'slack' };
      } else if ('subject' in response) {
        // Handle Email webhook response
        const subject = response.subject; // This should work if type inference is correct
        return { ...state, emailSubject: subject };
      }
    }
    return state;
  })
  .step('My Step 3', ({ state }) => {
    return state;
  });

export default myBrain;
