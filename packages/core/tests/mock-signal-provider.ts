import type { SignalProvider, BrainSignal } from '../src/dsl/types.js';

/**
 * A simple in-memory SignalProvider for testing.
 * Signals are consumed (deleted) when read via getSignals().
 */
export class MockSignalProvider implements SignalProvider {
  private signals: BrainSignal[] = [];

  /**
   * Queue a signal to be delivered on the next getSignals() call.
   * Signals are automatically sorted by priority: KILL > PAUSE > USER_MESSAGE
   */
  queueSignal(signal: BrainSignal): void {
    this.signals.push(signal);
    // Sort by priority: KILL (1) > PAUSE (2) > USER_MESSAGE (3)
    this.signals.sort((a, b) => {
      const priority = { KILL: 1, PAUSE: 2, USER_MESSAGE: 3 };
      return priority[a.type] - priority[b.type];
    });
  }

  /**
   * Get pending signals, consuming them in the process.
   * @param filter - 'CONTROL' returns only KILL/PAUSE, 'ALL' includes USER_MESSAGE
   */
  async getSignals(filter: 'CONTROL' | 'ALL'): Promise<BrainSignal[]> {
    const result =
      filter === 'ALL'
        ? [...this.signals]
        : this.signals.filter((s) => s.type === 'KILL' || s.type === 'PAUSE');

    // Consume signals (delete after returning)
    this.signals = this.signals.filter((s) => !result.includes(s));
    return result;
  }

  /**
   * Clear all pending signals.
   */
  clear(): void {
    this.signals = [];
  }
}
