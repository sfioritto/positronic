import type { Adapter, BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';
import type { MonitorDO } from './monitor-do.js';
import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Adapter that handles page cleanup when brains terminate.
 * Non-persistent pages are deleted from R2 when a brain completes, errors, or is cancelled.
 */
export class PageAdapter implements Adapter {
  constructor(
    private monitorStub: {
      getNonPersistentPagesForRun: (brainRunId: string) => Promise<string[]>;
      clearPageRegistrations: (brainRunId: string) => Promise<void>;
    },
    private resourcesBucket: R2Bucket
  ) {}

  async dispatch(event: BrainEvent): Promise<void> {
    // Only handle terminal events
    if (
      event.type !== BRAIN_EVENTS.COMPLETE &&
      event.type !== BRAIN_EVENTS.ERROR &&
      event.type !== BRAIN_EVENTS.CANCELLED
    ) {
      return;
    }

    try {
      // Get all non-persistent pages for this brain run
      const pageSlugs = await this.monitorStub.getNonPersistentPagesForRun(
        event.brainRunId
      );

      // Delete each page from R2
      for (const slug of pageSlugs) {
        const key = `pages/${slug}.html`;
        await this.resourcesBucket.delete(key);
      }

      // Clear the page registrations from MonitorDO
      await this.monitorStub.clearPageRegistrations(event.brainRunId);
    } catch (error) {
      console.error(
        `[PageAdapter] Error cleaning up pages for brain run ${event.brainRunId}:`,
        error
      );
      // Don't throw - we don't want to break other adapters
    }
  }
}
