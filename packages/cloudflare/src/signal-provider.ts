import type { SignalProvider, BrainSignal } from '@positronic/core';

/**
 * Cloudflare-specific SignalProvider implementation.
 * Reads signals from the BrainRunnerDO's SQLite storage.
 */
export class CloudflareSignalProvider implements SignalProvider {
  constructor(
    private getAndConsumeSignals: (filter: 'CONTROL' | 'WEBHOOK' | 'ALL') => BrainSignal[]
  ) {}

  async getSignals(filter: 'CONTROL' | 'WEBHOOK' | 'ALL'): Promise<BrainSignal[]> {
    return this.getAndConsumeSignals(filter);
  }
}
