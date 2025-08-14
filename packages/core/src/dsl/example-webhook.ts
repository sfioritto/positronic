import { brain } from './brain.js';
import { z } from 'zod';
import { Webhook } from './webhook.js';

// Example webhook class matching the design document
const slackWebhook: Webhook = (identifier: string) => {
  return {
    slug: 'slack-webhook',
    schema: z.object({
      message: z.string(),
      threadId: z.string(),
    }),
    identifier,
  };
};

const emailWebhook: Webhook = (identifier: string) => {
  return {
    identifier,
    schema: z.object({
      subject: z.string(),
      body: z.string(),
      from: z.string(),
    }),
    slug: 'email-webhook',
  };
};

const myBrain = brain('My Brain')
  .step('My Step', ({ state }) => {
    return {
      state,
      webhooks: [slackWebhook('thread-123'), emailWebhook('email-456')],
    };
  })
  .step('My Step 2', ({ state, response }) => {
    if (response) {
      if ('threadId' in response) {
        // Handle Slack webhook response
        return { ...state, slackMessage: 'slack' };
      } else if ('subject' in response) {
        // Handle Email webhook response
        // const subject = response.subject;
        return { ...state, emailSubject: 'email' };
      }
    }
    return state;
  })
  .step('My Step 3', ({ state }) => {
    return state;
  });

export default myBrain;
