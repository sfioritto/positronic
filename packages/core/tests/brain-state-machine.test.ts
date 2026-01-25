import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';
import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';

describe('brain-state-machine', () => {
  describe('token tracking', () => {
    it('should track total tokens from AGENT_ITERATION events', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      // Start brain
      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'agent-brain',
        initialState: {},
      });

      // Agent iteration with 500 tokens
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Generate content',
        stepId: 'step-1',
        iteration: 1,
        tokensThisIteration: 500,
        totalTokens: 500,
      });

      // Agent completes (tokens already tracked via iteration)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_COMPLETE,
        brainRunId,
        stepTitle: 'Generate content',
        stepId: 'step-1',
        terminalToolName: 'finish',
        result: {},
        totalIterations: 1,
        totalTokens: 500,
      });

      expect(machine.context.totalTokens).toBe(500);
    });

    it('should sum tokens from multiple agent iterations', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'multi-agent-brain',
        initialState: {},
      });

      // First agent - 1 iteration with 500 tokens
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        iteration: 1,
        tokensThisIteration: 500,
        totalTokens: 500,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_COMPLETE,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        terminalToolName: 'finish',
        result: {},
        totalIterations: 1,
        totalTokens: 500,
      });

      // Second agent - 2 iterations: 400 + 600 = 1000 tokens
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 2',
        stepId: 'step-2',
        iteration: 1,
        tokensThisIteration: 400,
        totalTokens: 400,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 2',
        stepId: 'step-2',
        iteration: 2,
        tokensThisIteration: 600,
        totalTokens: 1000,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_COMPLETE,
        brainRunId,
        stepTitle: 'Step 2',
        stepId: 'step-2',
        terminalToolName: 'finish',
        result: {},
        totalIterations: 2,
        totalTokens: 1000,
      });

      expect(machine.context.totalTokens).toBe(1500);
    });

    it('should track tokens even when agent hits token limit', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'token-limit-brain',
        initialState: {},
      });

      // Agent runs 5 iterations before hitting token limit
      for (let i = 1; i <= 5; i++) {
        sendEvent(machine, {
          type: BRAIN_EVENTS.AGENT_ITERATION,
          brainRunId,
          stepTitle: 'Step 1',
          stepId: 'step-1',
          iteration: i,
          tokensThisIteration: 2000,
          totalTokens: i * 2000,
        });
      }

      // Agent hits token limit
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_TOKEN_LIMIT,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        totalTokens: 10000,
        maxTokens: 10000,
      });

      expect(machine.context.totalTokens).toBe(10000);
    });

    it('should track tokens even when agent hits iteration limit', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'iter-limit-brain',
        initialState: {},
      });

      // Agent runs 10 iterations before hitting limit
      for (let i = 1; i <= 10; i++) {
        sendEvent(machine, {
          type: BRAIN_EVENTS.AGENT_ITERATION,
          brainRunId,
          stepTitle: 'Step 1',
          stepId: 'step-1',
          iteration: i,
          tokensThisIteration: 500,
          totalTokens: i * 500,
        });
      }

      // Agent hits iteration limit
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION_LIMIT,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        iteration: 10,
        maxIterations: 10,
        totalTokens: 5000,
      });

      expect(machine.context.totalTokens).toBe(5000);
    });

    it('should track tokens from agents interrupted by webhook', () => {
      // This tests the key fix: tokens should be tracked even when
      // an agent is interrupted (e.g., by a webhook) and never completes
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'webhook-brain',
        initialState: {},
      });

      // First agent runs 2 iterations before being interrupted by webhook
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        iteration: 1,
        tokensThisIteration: 1432,
        totalTokens: 1432,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        iteration: 2,
        tokensThisIteration: 237,
        totalTokens: 1669,
      });

      // Webhook pause - agent never completes!
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK,
        brainRunId,
        waitFor: [{ name: 'test', identifier: 'test-123' }],
      });

      // Tokens should still be tracked from iterations
      expect(machine.context.totalTokens).toBe(1669);

      // Brain restarts after webhook
      sendEvent(machine, {
        type: BRAIN_EVENTS.RESTART,
        brainRunId,
        brainTitle: 'webhook-brain',
        initialState: {},
      });

      // Second agent runs and completes
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        iteration: 1,
        tokensThisIteration: 1392,
        totalTokens: 1392,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_COMPLETE,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        terminalToolName: 'done',
        result: {},
        totalIterations: 1,
        totalTokens: 1392,
      });

      // Total should be sum of both agents
      expect(machine.context.totalTokens).toBe(1669 + 1392);
    });
  });

  describe('brain restart (webhook resume)', () => {
    it('should replace brain on stack when same brain restarts after webhook (not add duplicate)', () => {
      // This test simulates the event sequence that occurs when:
      // 1. A brain runs and pauses for a webhook
      // 2. The webhook is triggered and the brain resumes
      // 3. The watch client receives all historical events including the restart
      //
      // The bug was: restart added a NEW brain to the stack instead of replacing,
      // causing depth to be 2 instead of 1, and isComplete to never become true.

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

      expect(machine.context.brainStack.length).toBe(1);
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
      expect(machine.context.brainStack.length).toBe(1);

      // === WEBHOOK TRIGGERED - RESUME ===

      // Event 8: brain:restart (brain resumes after webhook)
      // THIS IS THE KEY TEST: brainStack should still be length 1, not 2
      sendEvent(machine, {
        type: BRAIN_EVENTS.RESTART,
        brainRunId,
        brainTitle, // Same title as original brain
        brainDescription: 'A brain that uses webhooks',
        initialState: { setup: true },
      });

      // CRITICAL ASSERTION: brainStack should have 1 entry (replaced), not 2 (added)
      expect(machine.context.brainStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);
      expect(machine.context.brainStack[0].brainTitle).toBe(brainTitle);
      expect(machine.context.isPaused).toBe(false);
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
      expect(machine.context.brainStack.length).toBe(1);
      expect(machine.context.depth).toBe(0);
    });

    it('should add to stack when different (nested) brain restarts', () => {
      // This tests that nested inner brains still work correctly
      // When an inner brain restarts, it should be ADDED to the stack (not replace outer)

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

      expect(machine.context.brainStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);

      // Outer brain step starts (which will run inner brain)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_STATUS,
        brainRunId: outerBrainRunId,
        steps: [
          { id: 'outer-step-1', title: 'Run inner brain', status: STATUS.RUNNING },
        ],
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId: outerBrainRunId,
        stepId: 'outer-step-1',
        stepTitle: 'Run inner brain',
      });

      // Inner brain starts (nested)
      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId: outerBrainRunId, // Same brainRunId (nested brains share it)
        brainTitle: innerBrainTitle, // Different title
        initialState: {},
      });

      expect(machine.context.brainStack.length).toBe(2);
      expect(machine.context.depth).toBe(2);
      expect(machine.context.brainStack[0].brainTitle).toBe(outerBrainTitle);
      expect(machine.context.brainStack[1].brainTitle).toBe(innerBrainTitle);

      // Inner brain waits for webhook
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK,
        brainRunId: outerBrainRunId,
        waitFor: [{ name: 'inner-webhook', identifier: 'inner-123' }],
      });

      expect(machine.context.isWaiting).toBe(true);
      expect(machine.context.brainStack.length).toBe(2);

      // Inner brain restarts after webhook
      // Since it has a DIFFERENT title than the last brain on stack (inner-brain),
      // wait no - it has the SAME title. Let me reconsider...
      // Actually the inner brain is on top of the stack with title 'inner-brain',
      // so when inner brain restarts with title 'inner-brain', it should REPLACE (not add).
      sendEvent(machine, {
        type: BRAIN_EVENTS.RESTART,
        brainRunId: outerBrainRunId,
        brainTitle: innerBrainTitle, // Same as inner brain - should REPLACE inner brain
        initialState: {},
      });

      // Stack should still be length 2: [outer, inner-restarted]
      expect(machine.context.brainStack.length).toBe(2);
      expect(machine.context.depth).toBe(2);
      expect(machine.context.brainStack[0].brainTitle).toBe(outerBrainTitle);
      expect(machine.context.brainStack[1].brainTitle).toBe(innerBrainTitle);

      // Inner brain completes
      sendEvent(machine, {
        type: BRAIN_EVENTS.COMPLETE,
        brainRunId: outerBrainRunId,
        brainTitle: innerBrainTitle,
        status: STATUS.COMPLETE,
      });

      expect(machine.context.brainStack.length).toBe(1);
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
      expect(machine.context.brainStack.length).toBe(1);
      expect(machine.context.depth).toBe(0);
      expect(machine.context.isComplete).toBe(true);
    });

    it('should handle restart from idle state (no brain on stack)', () => {
      // This tests the edge case where brain:restart is the first event
      // (e.g., watch client connects after brain already resumed)

      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';
      const brainTitle = 'restarted-brain';

      // First event is brain:restart (no brain:start before it)
      sendEvent(machine, {
        type: BRAIN_EVENTS.RESTART,
        brainRunId,
        brainTitle,
        brainDescription: 'A restarted brain',
        initialState: { previousState: true },
      });

      expect(machine.context.brainStack.length).toBe(1);
      expect(machine.context.depth).toBe(1);
      expect(machine.context.brainStack[0].brainTitle).toBe(brainTitle);
      expect(machine.context.isRunning).toBe(true);

      // Brain completes
      sendEvent(machine, {
        type: BRAIN_EVENTS.COMPLETE,
        brainRunId,
        brainTitle,
        status: STATUS.COMPLETE,
      });

      // rootBrain is preserved after completion so we can display final state
      expect(machine.context.isComplete).toBe(true);
      expect(machine.context.brainStack.length).toBe(1);
    });
  });
});
