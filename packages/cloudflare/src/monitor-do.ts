import { DurableObject } from 'cloudflare:workers';
import type { WorkflowEvent } from '@positronic/core';

export interface Env {
  // Add any environment bindings here as needed
}

export class MonitorDO extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async handleWorkflowEvent(event: WorkflowEvent<any>): Promise<void> {
    // For now, just log the event
    console.log('[MONITOR_DO] Received workflow event:', event);
  }
}
