import type { SignalProvider, BrainSignal } from '@positronic/core';

/**
 * Cloudflare-specific SignalProvider implementation.
 * Reads signals from the BrainRunnerDO's SQLite storage.
 */
type SignalFilter = 'CONTROL' | 'WEBHOOK' | 'ALL';

export class CloudflareSignalProvider implements SignalProvider {
  constructor(
    private getAndConsumeSignals: (filter: SignalFilter) => BrainSignal[]
  ) {}

  async getSignals(filter: SignalFilter): Promise<BrainSignal[]> {
    return this.getAndConsumeSignals(filter);
  }
}
