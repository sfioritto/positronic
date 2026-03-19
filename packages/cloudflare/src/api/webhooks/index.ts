import { Hono, type Context } from 'hono';
import { getWebhookManifest, startBrainRun } from '../../brain-runner-do.js';
import type { Bindings } from '../types.js';
import { queueWebhookAndWakeUp } from './coordination.js';
import system from './system.js';

const webhooks = new Hono<{ Bindings: Bindings }>();

// Mount system webhooks at /webhooks/system/*
webhooks.route('/system', system);

// List all webhooks (user-defined only)
webhooks.get('/', async (context: Context) => {
  const webhookManifest = getWebhookManifest();

  const webhookList = Object.entries(webhookManifest).map(
    ([slug, webhook]: [string, any]) => ({
      slug,
      description: webhook.description,
    })
  );

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

    // Handler determined this event should be ignored
    if (handlerResult.type === 'ignore') {
      return context.json({ received: true, action: 'ignored' });
    }

    // Trigger a new brain run
    if (handlerResult.type === 'trigger') {
      if (!webhook.triggers) {
        return context.json(
          {
            error: `Webhook '${slug}' returned trigger result but has no triggers config`,
          },
          400
        );
      }

      const brainRunId = await startBrainRun(
        context.env.BRAIN_RUNNER_DO,
        webhook.triggers.brain,
        { name: webhook.triggers.runAs },
        { initialState: handlerResult.response }
      );
      return context.json(
        { received: true, action: 'triggered', brainRunId },
        201
      );
    }

    // CSRF token is passed as a query parameter (if present)
    const submittedToken = context.req.query('token') || null;

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
