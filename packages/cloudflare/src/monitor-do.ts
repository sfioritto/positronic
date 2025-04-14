import { DurableObject } from 'cloudflare:workers';
import type { WorkflowCompleteEvent, WorkflowEvent } from '@positronic/core';

export interface Env {
  // Add any environment bindings here as needed
}

export class MonitorDO extends DurableObject<Env> {
  private lastEvent: WorkflowCompleteEvent | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async handleWorkflowEvent(event: WorkflowEvent) {
    if (event.type === 'workflow:complete') {
      this.lastEvent = event;
    }
  }

  async getLastEvent() {
    if (!this.lastEvent) {
      throw new Error('No last event found');
    }
    return this.lastEvent;
  }
}
