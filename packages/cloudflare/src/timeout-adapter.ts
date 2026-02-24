import type { Adapter, BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';

/**
 * Adapter that handles WEBHOOK events with a timeout by storing the
 * timeout and scheduling a DO alarm. When the alarm fires and the
 * brain is still waiting, it queues a KILL signal to cancel the brain.
 */
export class TimeoutAdapter implements Adapter {
  constructor(
    private storeTimeout: (brainRunId: string, timeoutAt: number) => void,
    private setAlarm: (time: number) => Promise<void>
  ) {}

  async dispatch(event: BrainEvent): Promise<void> {
    if (event.type !== BRAIN_EVENTS.WEBHOOK) {
      return;
    }

    const timeout = (event as any).timeout as number | undefined;
    if (timeout === undefined) {
      return;
    }

    const timeoutAt = Date.now() + timeout;
    this.storeTimeout(event.brainRunId, timeoutAt);
    await this.setAlarm(timeoutAt);
  }
}
