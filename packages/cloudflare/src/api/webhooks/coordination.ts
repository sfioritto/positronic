import type { Context } from 'hono';
import { isSignalValid, brainMachineDefinition, validateWebhookToken } from '@positronic/core';

/**
 * Result from a webhook handler.
 * Either a verification challenge (for Slack, Stripe, etc.) or a normal response.
 */
export type WebhookHandlerResult =
  | { type: 'verification'; challenge: string }
  | { type?: undefined; identifier: string; response: Record<string, unknown> };

/**
 * Find a brain waiting for a webhook, queue the WEBHOOK_RESPONSE signal, and wake it up.
 * Returns a JSON response object suitable for returning from a webhook endpoint.
 *
 * This is the signal-based approach: webhook response data flows through the signal queue
 * rather than being passed directly to the resume method.
 */
export async function queueWebhookAndWakeUp(
  context: Context,
  slug: string,
  identifier: string,
  response: Record<string, unknown>,
  submittedToken?: string | null
): Promise<{
  received: boolean;
  action: 'resumed' | 'not_found' | 'queued' | 'ignored';
  identifier: string;
  brainRunId?: string;
  message?: string;
  reason?: string;
}> {
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const result = await monitorStub.findWaitingBrain(slug, identifier);

  if (result) {
    const { brainRunId, token: expectedToken } = result;

    // Validate CSRF token
    const tokenValidation = validateWebhookToken(expectedToken, submittedToken);
    if (!tokenValidation.valid) {
      return {
        received: true,
        action: 'ignored',
        identifier,
        brainRunId,
        reason: tokenValidation.reason,
      };
    }

    // Warn in dev mode when no token is present — may indicate an unprotected form
    if (!expectedToken && !submittedToken && context.env.NODE_ENV === 'development') {
      console.warn(
        `[positronic] Webhook "${slug}" received without a CSRF token. ` +
        `This is fine if you validate the request in your webhook handler, ` +
        `but if this webhook receives form submissions from a page, consider ` +
        `adding a token with generateFormToken(). See the docs for details.`
      );
    }
    // Found a brain - verify it can receive webhook response
    const run = await monitorStub.getRun(brainRunId);
    if (run) {
      const validation = isSignalValid(brainMachineDefinition, run.status, 'WEBHOOK_RESPONSE');
      if (!validation.valid) {
        return {
          received: true,
          action: 'ignored',
          identifier,
          brainRunId,
          reason: validation.reason,
        };
      }
    }

    // Queue WEBHOOK_RESPONSE signal and wake up the brain
    const namespace = context.env.BRAIN_RUNNER_DO;
    const doId = namespace.idFromName(brainRunId);
    const stub = namespace.get(doId);

    // Queue the signal first, then wake up the brain
    await stub.queueSignal({ type: 'WEBHOOK_RESPONSE', response });
    await stub.wakeUp(brainRunId);

    return {
      received: true,
      action: 'resumed',
      identifier,
      brainRunId,
    };
  }

  // No brain waiting for this webhook
  return {
    received: true,
    action: 'not_found',
    identifier,
    message: 'No brain waiting for this webhook',
  };
}

// Re-export parseFormData from core for backwards compatibility
export { parseFormData } from '@positronic/core';
