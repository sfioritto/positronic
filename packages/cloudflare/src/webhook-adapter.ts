import type { Adapter, BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';
import type { MonitorDO } from './monitor-do.js';

/**
 * Adapter that handles WEBHOOK events by registering webhooks
 * with the MonitorDO for brain resumption
 */
export class WebhookAdapter implements Adapter {
  constructor(private monitorStub: { registerWebhook: MonitorDO['registerWebhook'] }) {}

  async dispatch(event: BrainEvent): Promise<void> {
    // Only handle WEBHOOK events
    if (event.type !== BRAIN_EVENTS.WEBHOOK) {
      return;
    }

    // Register each webhook with the MonitorDO
    for (const registration of event.waitFor) {
      await this.monitorStub.registerWebhook(
        registration.slug,
        registration.identifier,
        event.brainRunId
      );
    }
  }
}
