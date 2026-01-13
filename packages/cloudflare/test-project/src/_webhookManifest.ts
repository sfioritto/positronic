// This file simulates what the auto-generated _webhookManifest.ts would look like
// It imports webhooks from the webhooks/ directory with default exports
import webhook_test_webhook from '../webhooks/test-webhook.js';
import webhook_notification from '../webhooks/notification.js';
import webhook_inner_webhook from '../webhooks/inner-webhook.js';
import webhook_loop_escalation from '../webhooks/loop-escalation.js';

export const webhookManifest: Record<string, any> = {
  'test-webhook': webhook_test_webhook,
  'notification': webhook_notification,
  'inner-webhook': webhook_inner_webhook,
  'loop-escalation': webhook_loop_escalation,
};
