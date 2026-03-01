import {
  isSignalValid,
  getValidSignals,
} from '../src/dsl/signal-validation.js';
import { brainMachineDefinition } from '../src/dsl/brain-state-machine.js';
import { STATUS } from '../src/dsl/constants.js';

describe('signal validation', () => {
  describe('isSignalValid', () => {
    describe('PAUSE signal', () => {
      it('allows PAUSE from running state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.RUNNING, 'PAUSE');
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('rejects PAUSE from complete state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.COMPLETE, 'PAUSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot PAUSE brain in 'complete' state");
      });

      it('rejects PAUSE from cancelled state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.CANCELLED, 'PAUSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot PAUSE brain in 'cancelled' state");
      });

      it('rejects PAUSE from error state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.ERROR, 'PAUSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot PAUSE brain in 'error' state");
      });

      it('rejects PAUSE from waiting state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.WAITING, 'PAUSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot PAUSE brain in 'waiting' state");
      });

      it('rejects PAUSE from paused state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.PAUSED, 'PAUSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot PAUSE brain in 'paused' state");
      });
    });

    describe('KILL signal', () => {
      it('allows KILL from running state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.RUNNING, 'KILL');
        expect(result.valid).toBe(true);
      });

      it('allows KILL from paused state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.PAUSED, 'KILL');
        expect(result.valid).toBe(true);
      });

      it('allows KILL from waiting state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.WAITING, 'KILL');
        expect(result.valid).toBe(true);
      });

      it('rejects KILL from complete state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.COMPLETE, 'KILL');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot KILL brain in 'complete' state");
      });

      it('rejects KILL from error state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.ERROR, 'KILL');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot KILL brain in 'error' state");
      });

      it('rejects KILL from cancelled state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.CANCELLED, 'KILL');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot KILL brain in 'cancelled' state");
      });
    });

    describe('RESUME signal', () => {
      it('allows RESUME from paused state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.PAUSED, 'RESUME');
        expect(result.valid).toBe(true);
      });

      it('rejects RESUME from running state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.RUNNING, 'RESUME');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot RESUME brain in 'running' state");
      });

      it('rejects RESUME from complete state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.COMPLETE, 'RESUME');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot RESUME brain in 'complete' state");
      });

      it('allows RESUME from waiting state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.WAITING, 'RESUME');
        expect(result.valid).toBe(true);
      });
    });

    describe('WEBHOOK_RESPONSE signal', () => {
      it('allows WEBHOOK_RESPONSE from waiting state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.WAITING, 'WEBHOOK_RESPONSE');
        expect(result.valid).toBe(true);
      });

      it('allows WEBHOOK_RESPONSE from running state', () => {
        // Running state also has a webhook_response transition for non-agent webhooks
        const result = isSignalValid(brainMachineDefinition, STATUS.RUNNING, 'WEBHOOK_RESPONSE');
        expect(result.valid).toBe(true);
      });

      it('rejects WEBHOOK_RESPONSE from paused state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.PAUSED, 'WEBHOOK_RESPONSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot WEBHOOK_RESPONSE brain in 'paused' state");
      });

      it('rejects WEBHOOK_RESPONSE from complete state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.COMPLETE, 'WEBHOOK_RESPONSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("Cannot WEBHOOK_RESPONSE brain in 'complete' state");
      });
    });

    describe('USER_MESSAGE signal', () => {
      // USER_MESSAGE requires agentLoop state, which maps to 'running' status
      // but the transition is only defined on agentLoop state, not running state
      it('rejects USER_MESSAGE from running state (non-agent)', () => {
        // Regular running state doesn't have USER_MESSAGE transition
        const result = isSignalValid(brainMachineDefinition, STATUS.RUNNING, 'USER_MESSAGE');
        expect(result.valid).toBe(false);
      });

      it('rejects USER_MESSAGE from paused state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.PAUSED, 'USER_MESSAGE');
        expect(result.valid).toBe(false);
      });

      it('rejects USER_MESSAGE from waiting state', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.WAITING, 'USER_MESSAGE');
        expect(result.valid).toBe(false);
      });
    });

    describe('error handling', () => {
      it('rejects unknown signal type', () => {
        const result = isSignalValid(brainMachineDefinition, STATUS.RUNNING, 'UNKNOWN_SIGNAL');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Unknown signal type: UNKNOWN_SIGNAL');
      });

      it('rejects unknown brain status', () => {
        const result = isSignalValid(brainMachineDefinition, 'unknown_status', 'PAUSE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Unknown brain status: unknown_status');
      });
    });
  });

  describe('getValidSignals', () => {
    it('returns valid signals for running state', () => {
      const signals = getValidSignals(brainMachineDefinition, STATUS.RUNNING);
      expect(signals).toContain('PAUSE');
      expect(signals).toContain('KILL');
      expect(signals).toContain('WEBHOOK_RESPONSE');
      expect(signals).not.toContain('RESUME');
    });

    it('returns valid signals for paused state', () => {
      const signals = getValidSignals(brainMachineDefinition, STATUS.PAUSED);
      expect(signals).toContain('RESUME');
      expect(signals).toContain('KILL');
      expect(signals).not.toContain('PAUSE');
    });

    it('returns valid signals for waiting state', () => {
      const signals = getValidSignals(brainMachineDefinition, STATUS.WAITING);
      expect(signals).toContain('WEBHOOK_RESPONSE');
      expect(signals).toContain('KILL');
      expect(signals).toContain('RESUME');
      expect(signals).not.toContain('PAUSE');
    });

    it('returns empty array for complete state', () => {
      const signals = getValidSignals(brainMachineDefinition, STATUS.COMPLETE);
      expect(signals).toEqual([]);
    });

    it('returns empty array for cancelled state', () => {
      const signals = getValidSignals(brainMachineDefinition, STATUS.CANCELLED);
      expect(signals).toEqual([]);
    });

    it('returns empty array for unknown status', () => {
      const signals = getValidSignals(brainMachineDefinition, 'unknown_status');
      expect(signals).toEqual([]);
    });
  });
});
