import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';
import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';

describe('brain-state-machine', () => {
  describe('guard step halting', () => {
    it('should mark step as HALTED when event has halted flag', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'guard-brain',
        initialState: {},
      });

      // Guard step completes (guard evaluated)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'guard-step',
        stepTitle: 'Guard',
        stepIndex: 0,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'guard-step',
        stepTitle: 'Guard',
        patch: [],
      });

      // Remaining step halted because guard failed
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'halted-step',
        stepTitle: 'Process',
        patch: [],
        halted: true,
      });

      // Verify guard is COMPLETE
      const brain = machine.context.brains['guard-brain'];
      const guardStep = brain.steps.find((s) => s.id === 'guard-step');
      expect(guardStep?.status).toBe(STATUS.COMPLETE);

      // Verify remaining step is HALTED
      const processStep = brain.steps.find((s) => s.id === 'halted-step');
      expect(processStep?.status).toBe(STATUS.HALTED);

      // Verify state is unchanged (guard doesn't modify state)
      expect(machine.context.currentState).toEqual({});
    });

    it('should not increment topLevelStepCount for halted steps', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'step-count-brain',
        initialState: {},
      });

      // Normal step completes
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'step-1',
        stepTitle: 'Step 1',
        stepIndex: 0,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-1',
        stepTitle: 'Step 1',
        patch: [{ op: 'add', path: '/done', value: true }],
      });

      expect(machine.context.topLevelStepCount).toBe(1);

      // Halted step should not increment count
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-2',
        stepTitle: 'Halted Step',
        patch: [],
        halted: true,
      });

      expect(machine.context.topLevelStepCount).toBe(1);
    });

    it('should still advance stepIndex for halted steps', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'advance-brain',
        initialState: {},
      });

      // Complete step 0 normally
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'step-0',
        stepTitle: 'Step 0',
        stepIndex: 0,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-0',
        stepTitle: 'Step 0',
        patch: [{ op: 'add', path: '/a', value: 1 }],
      });

      expect(machine.context.executionStack[0].stepIndex).toBe(1);

      // Halt step 1 (guard failed)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-1',
        stepTitle: 'Halted',
        patch: [],
        halted: true,
      });

      // stepIndex should still advance past the halted step
      expect(machine.context.executionStack[0].stepIndex).toBe(2);
      // But state should not change
      expect(machine.context.executionStack[0].state).toEqual({ a: 1 });
    });
  });

  describe('webhook resume', () => {
    it('should resume from waiting state via WEBHOOK_RESPONSE', () => {
      // This test simulates the event sequence that occurs when:
      // 1. A brain runs and pauses for a webhook
      // 2. The webhook is triggered and the brain resumes via WEBHOOK_RESPONSE

      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';
      const brainTitle = 'webhook-brain';

      // Event 1: brain:start
      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle,
        brainDescription: 'A brain that uses webhooks',
        initialState: {},
      });

      expect(machine.context.brainIdStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);
      expect(machine.context.isComplete).toBe(false);

      // Event 2: step:status (initial steps)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId,
        steps: [
          { id: 'step-1', title: 'Setup', status: STATUS.PENDING },
          { id: 'step-2', title: 'Wait for webhook', status: STATUS.PENDING },
          { id: 'step-3', title: 'Process response', status: STATUS.PENDING },
        ],
      });

      // Event 3: step:start
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'step-1',
        stepTitle: 'Setup',
        stepIndex: 0,
      });

      // Event 4: step:complete
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-1',
        stepTitle: 'Setup',
        patch: [{ op: 'add', path: '/setup', value: true }],
      });

      // Event 5: step:start (webhook step)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'step-2',
        stepTitle: 'Wait for webhook',
        stepIndex: 1,
      });

      // Event 6: step:complete (webhook step completes before webhook)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-2',
        stepTitle: 'Wait for webhook',
        patch: [],
      });

      // Event 7: brain:webhook (brain waits for webhook)
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK,
        brainRunId,
        waitFor: [{ name: 'webhook-brain', identifier: 'test-123' }],
      });

      expect(machine.context.isWaiting).toBe(true);
      expect(machine.context.brainIdStack.length).toBe(1);

      // === WEBHOOK TRIGGERED - RESUME ===

      // Event 8: webhook:response (brain resumes after webhook)
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
        brainRunId,
        response: { data: 'test' },
      });

      // Brain should be running again
      expect(machine.context.brainIdStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);
      expect(machine.context.brainIdStack[0]).toBe(brainTitle);
      expect(machine.context.isWaiting).toBe(false);
      expect(machine.context.isRunning).toBe(true);

      // Event 9: step:status (after resume)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId,
        steps: [
          { id: 'step-1', title: 'Setup', status: STATUS.COMPLETE },
          { id: 'step-2', title: 'Wait for webhook', status: STATUS.COMPLETE },
          { id: 'step-3', title: 'Process response', status: STATUS.RUNNING },
        ],
      });

      // Event 10: step:start (final step)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'step-3',
        stepTitle: 'Process response',
        stepIndex: 2,
      });

      // Event 11: step:complete (final step)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-3',
        stepTitle: 'Process response',
        patch: [{ op: 'add', path: '/response', value: 'processed' }],
      });

      // Event 12: brain:complete
      sendEvent(machine, {
        type: BRAIN_EVENTS.COMPLETE,
        brainRunId,
        brainTitle,
        status: STATUS.COMPLETE,
      });

      // CRITICAL ASSERTION: brain should be complete
      // rootBrain is preserved after completion so we can display final state
      expect(machine.context.isComplete).toBe(true);
      expect(machine.context.brainIdStack.length).toBe(1);
      expect(machine.context.depth).toBe(0);
    });

    it('should handle nested brain with webhook', () => {
      // This tests that nested inner brains with webhooks work correctly
      // Using WEBHOOK_RESPONSE to resume

      const machine = createBrainExecutionMachine();
      const outerBrainRunId = 'outer-run-123';
      const outerBrainTitle = 'outer-brain';
      const innerBrainTitle = 'inner-brain';

      // Start outer brain
      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId: outerBrainRunId,
        brainTitle: outerBrainTitle,
        initialState: {},
      });

      expect(machine.context.brainIdStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);

      // Outer brain step starts (which will run inner brain)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId: outerBrainRunId,
        steps: [
          {
            id: 'outer-step-1',
            title: 'Run inner brain',
            status: STATUS.RUNNING,
          },
        ],
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId: outerBrainRunId,
        stepId: 'outer-step-1',
        stepTitle: 'Run inner brain',
        stepIndex: 0,
      });

      // Inner brain starts (nested)
      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId: outerBrainRunId, // Same brainRunId (nested brains share it)
        brainTitle: innerBrainTitle, // Different title
        initialState: {},
      });

      expect(machine.context.brainIdStack.length).toBe(2);
      expect(machine.context.depth).toBe(2);
      expect(machine.context.brainIdStack[0]).toBe(outerBrainTitle);
      expect(machine.context.brainIdStack[1]).toBe(innerBrainTitle);

      // Inner brain waits for webhook
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK,
        brainRunId: outerBrainRunId,
        waitFor: [{ name: 'inner-webhook', identifier: 'inner-123' }],
      });

      expect(machine.context.isWaiting).toBe(true);
      expect(machine.context.brainIdStack.length).toBe(2);

      // Inner brain resumes after webhook via WEBHOOK_RESPONSE
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
        brainRunId: outerBrainRunId,
        response: { data: 'webhook data' },
      });

      // Stack should still be length 2: [outer, inner]
      expect(machine.context.brainIdStack.length).toBe(2);
      expect(machine.context.depth).toBe(2);
      expect(machine.context.brainIdStack[0]).toBe(outerBrainTitle);
      expect(machine.context.brainIdStack[1]).toBe(innerBrainTitle);
      expect(machine.context.isWaiting).toBe(false);
      expect(machine.context.isRunning).toBe(true);

      // Inner brain completes
      sendEvent(machine, {
        type: BRAIN_EVENTS.COMPLETE,
        brainRunId: outerBrainRunId,
        brainTitle: innerBrainTitle,
        status: STATUS.COMPLETE,
      });

      expect(machine.context.brainIdStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);
      expect(machine.context.isComplete).toBe(false); // Outer brain not complete yet

      // Outer brain completes
      sendEvent(machine, {
        type: BRAIN_EVENTS.COMPLETE,
        brainRunId: outerBrainRunId,
        brainTitle: outerBrainTitle,
        status: STATUS.COMPLETE,
      });

      // rootBrain is preserved after completion so we can display final state
      expect(machine.context.brainIdStack.length).toBe(1);
      expect(machine.context.depth).toBe(0);
      expect(machine.context.isComplete).toBe(true);
    });
  });
});
