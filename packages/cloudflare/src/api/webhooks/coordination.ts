import type { Context } from 'hono';
import { isSignalValid, brainMachineDefinition } from '@positronic/core';

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

    // Validate CSRF token - reject if tokens don't match
    // Both null/undefined = no token on either side (custom webhooks) = OK
    // Both present and equal = valid form submission = OK
    // Any other combination = reject
    if ((expectedToken || submittedToken) && expectedToken !== submittedToken) {
      return {
        received: true,
        action: 'ignored',
        identifier,
        brainRunId,
        reason: 'Invalid form token',
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

/**
 * Parse form data into a plain object, handling array fields.
 * Extracts and strips the __positronic_token CSRF field.
 * Supports:
 * - name[] syntax for explicit arrays
 * - Multiple values with same key (converted to array)
 */
export function parseFormData(formData: FormData): { data: Record<string, unknown>; token: string | null } {
  const result: Record<string, unknown> = {};
  let token: string | null = null;

  for (const [key, value] of formData.entries()) {
    // Extract CSRF token and exclude from response data
    if (key === '__positronic_token') {
      token = value as string;
      continue;
    }

    // Handle array fields (e.g., name[] for multi-select)
    if (key.endsWith('[]')) {
      const baseKey = key.slice(0, -2);
      if (!result[baseKey]) {
        result[baseKey] = [];
      }
      (result[baseKey] as unknown[]).push(value);
    } else if (result[key] !== undefined) {
      // Convert to array if same key appears multiple times
      if (!Array.isArray(result[key])) {
        result[key] = [result[key]];
      }
      (result[key] as unknown[]).push(value);
    } else {
      result[key] = value;
    }
  }

  return { data: result, token };
}
