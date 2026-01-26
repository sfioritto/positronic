import type { SignalProvider, BrainSignal } from '@positronic/core';

/**
 * Cloudflare-specific SignalProvider implementation.
 * Reads signals from the BrainRunnerDO's SQLite storage.
 */
export class CloudflareSignalProvider implements SignalProvider {
  constructor(
    private getAndConsumeSignals: (filter: 'CONTROL' | 'ALL') => BrainSignal[]
  ) {}

  async getSignals(filter: 'CONTROL' | 'ALL'): Promise<BrainSignal[]> {
    return this.getAndConsumeSignals(filter);
  }
}
