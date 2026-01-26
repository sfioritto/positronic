import type { SignalProvider, BrainSignal } from '../src/dsl/types.js';

/**
 * A simple in-memory SignalProvider for testing.
 * Signals are consumed (deleted) when read via getSignals().
 */
export class MockSignalProvider implements SignalProvider {
  private signals: BrainSignal[] = [];

  /**
   * Queue a signal to be delivered on the next getSignals() call.
   * Signals are automatically sorted by priority: KILL > PAUSE > WEBHOOK_RESPONSE > RESUME > USER_MESSAGE
   */
  queueSignal(signal: BrainSignal): void {
    this.signals.push(signal);
    // Sort by priority: KILL (1) > PAUSE (2) > WEBHOOK_RESPONSE (3) > RESUME (4) > USER_MESSAGE (5)
    this.signals.sort((a, b) => {
      const priority: Record<string, number> = { KILL: 1, PAUSE: 2, WEBHOOK_RESPONSE: 3, RESUME: 4, USER_MESSAGE: 5 };
      return priority[a.type] - priority[b.type];
    });
  }

  /**
   * Get pending signals, consuming them in the process.
   * @param filter - 'CONTROL' returns only KILL/PAUSE, 'WEBHOOK' returns only WEBHOOK_RESPONSE, 'ALL' includes all signal types
   */
  async getSignals(filter: 'CONTROL' | 'WEBHOOK' | 'ALL'): Promise<BrainSignal[]> {
    let result: BrainSignal[];
    if (filter === 'ALL') {
      result = [...this.signals];
    } else if (filter === 'WEBHOOK') {
      result = this.signals.filter((s) => s.type === 'WEBHOOK_RESPONSE');
    } else {
      result = this.signals.filter((s) => s.type === 'KILL' || s.type === 'PAUSE');
    }

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
