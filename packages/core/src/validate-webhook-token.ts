import type { SignalValidationResult } from './dsl/signal-validation.js';

/**
 * Validate a CSRF token submitted with a webhook form.
 *
 * - Both null/undefined = no token on either side (custom webhooks) = valid
 * - Both present and equal = valid form submission
 * - Any other combination = invalid
 */
export function validateWebhookToken(
  expectedToken: string | null | undefined,
  submittedToken: string | null | undefined
): SignalValidationResult {
  if ((expectedToken || submittedToken) && expectedToken !== submittedToken) {
    return { valid: false, reason: 'Invalid form token' };
  }
  return { valid: true };
}
