import { Hono, type Context } from 'hono';
import { getWebhookManifest } from '../../brain-runner-do.js';
import type { Bindings } from '../types.js';
import { findAndResumeBrain } from './coordination.js';
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
    // Call the webhook handler to process the incoming request
    const handlerResult = await webhook.handler(context.req.raw);

    // Handle verification challenge (for Slack, Stripe, GitHub, Discord)
    if (handlerResult.type === 'verification') {
      return context.json({ challenge: handlerResult.challenge });
    }

    // Normal webhook processing - use shared coordination logic
    const result = await findAndResumeBrain(
      context,
      slug,
      handlerResult.identifier,
      handlerResult.response
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
