import { Hono, type Context } from 'hono';
import { getWebhookManifest } from '../../brain-runner-do.js';
import type { Bindings } from '../types.js';
import { queueWebhookAndWakeUp } from './coordination.js';
import system from './system.js';

const webhooks = new Hono<{ Bindings: Bindings }>();

// Mount system webhooks at /webhooks/system/*
webhooks.route('/system', system);

// List all webhooks (user-defined only)
webhooks.get('/', async (context: Context) => {
  const webhookManifest = getWebhookManifest();

  const webhookList = Object.entries(webhookManifest).map(([slug, webhook]: [string, any]) => ({
    slug,
    description: webhook.description,
  }));

  return context.json({
    webhooks: webhookList,
    count: webhookList.length,
  });
});

// Receive incoming webhook from external service (user-defined webhooks)
webhooks.post('/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const webhookManifest = getWebhookManifest();
  const webhook = webhookManifest[slug];

  if (!webhook) {
    return context.json({ error: `Webhook '${slug}' not found` }, 404);
  }

  try {
    // Clone the request so we can extract the CSRF token separately
    // without consuming the body that the user's handler needs
    const clonedReq = context.req.raw.clone();

    // Call the webhook handler to process the incoming request
    const handlerResult = await webhook.handler(context.req.raw);

    // Handle verification challenge (for Slack, Stripe, GitHub, Discord)
    if (handlerResult.type === 'verification') {
      return context.json({ challenge: handlerResult.challenge });
    }

    // Extract CSRF token from form submissions
    let submittedToken: string | null = null;
    const contentType = clonedReq.headers.get('content-type') || '';
    if (contentType.includes('form-urlencoded') || contentType.includes('form-data')) {
      try {
        const formData = await clonedReq.formData();
        submittedToken = formData.get('__positronic_token') as string | null;
      } catch {
        // Not parseable as form data, skip token extraction
      }
    }

    // Normal webhook processing - queue signal and wake up brain
    const result = await queueWebhookAndWakeUp(
      context,
      slug,
      handlerResult.identifier,
      handlerResult.response,
      submittedToken
    );

    // For user webhooks, return 'queued' instead of 'not_found' when no brain is waiting
    // This allows webhooks to be received even when no brain is actively waiting
    if (result.action === 'not_found') {
      return context.json({
        received: true,
        action: 'queued',
        identifier: handlerResult.identifier,
      });
    }

    return context.json(result);
  } catch (error) {
    console.error(`Error receiving webhook ${slug}:`, error);
    return context.json({ error: 'Failed to process webhook' }, 500);
  }
});

export default webhooks;
