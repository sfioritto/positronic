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

      // Start agent step (transitions to agentLoop state)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId,
        stepTitle: 'Generate content',
        stepId: 'step-1',
        prompt: 'Generate some content',
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

      // First agent - start (transitions to agentLoop)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        prompt: 'First prompt',
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

      // Second agent - start (transitions to agentLoop)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId,
        stepTitle: 'Step 2',
        stepId: 'step-2',
        prompt: 'Second prompt',
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

      // Start agent (transitions to agentLoop)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        prompt: 'Generate tokens',
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

      // Start agent (transitions to agentLoop)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        prompt: 'Run many iterations',
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

      // Start agent (transitions to agentLoop)
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_START,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        prompt: 'Generate with webhook',
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

      // Webhook pause - agent is interrupted but agentContext preserved
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK,
        brainRunId,
        waitFor: [{ name: 'test', identifier: 'test-123' }],
      });

      // Tokens should still be tracked from iterations
      expect(machine.context.totalTokens).toBe(1669);

      // Brain resumes after webhook via WEBHOOK_RESPONSE - goes back to agentLoop since agentContext exists
      sendEvent(machine, {
        type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
        brainRunId,
        response: { data: 'webhook data' },
      });

      // Agent resumes and continues iterating
      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_ITERATION,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        iteration: 3,
        tokensThisIteration: 1392,
        totalTokens: 3061,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.AGENT_COMPLETE,
        brainRunId,
        stepTitle: 'Step 1',
        stepId: 'step-1',
        terminalToolName: 'done',
        result: {},
        totalIterations: 3,
        totalTokens: 3061,
      });

      // Total should be sum of all iterations
      expect(machine.context.totalTokens).toBe(1669 + 1392);
    });
  });

  describe('conditional step skipping', () => {
    it('should mark step as SKIPPED when event has skipped flag', () => {
      const machine = createBrainExecutionMachine();
      const brainRunId = 'test-run-123';

      sendEvent(machine, {
        type: BRAIN_EVENTS.START,
        brainRunId,
        brainTitle: 'conditional-brain',
        initialState: {},
      });

      // Execute the then-branch (normal step flow)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_START,
        brainRunId,
        stepId: 'then-step',
        stepTitle: 'Then Branch',
        stepIndex: 0,
      });

      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'then-step',
        stepTitle: 'Then Branch',
        patch: [{ op: 'add', path: '/branch', value: 'then' }],
      });

      // Skip the else-branch (skipped flag)
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'else-step',
        stepTitle: 'Else Branch',
        patch: [],
        skipped: true,
      });

      // Verify then-branch is COMPLETE
      const brain = machine.context.brains['conditional-brain'];
      const thenStep = brain.steps.find(s => s.id === 'then-step');
      expect(thenStep?.status).toBe(STATUS.COMPLETE);

      // Verify else-branch is SKIPPED
      const elseStep = brain.steps.find(s => s.id === 'else-step');
      expect(elseStep?.status).toBe(STATUS.SKIPPED);

      // Verify state only has the then-branch's changes
      expect(machine.context.currentState).toEqual({ branch: 'then' });
    });

    it('should not increment topLevelStepCount for skipped steps', () => {
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

      // Skipped step should not increment count
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-2',
        stepTitle: 'Skipped Step',
        patch: [],
        skipped: true,
      });

      expect(machine.context.topLevelStepCount).toBe(1);
    });

    it('should still advance stepIndex for skipped steps', () => {
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

      // Skip step 1
      sendEvent(machine, {
        type: BRAIN_EVENTS.STEP_COMPLETE,
        brainRunId,
        stepId: 'step-1',
        stepTitle: 'Skipped',
        patch: [],
        skipped: true,
      });

      // stepIndex should still advance past the skipped step
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
          { id: 'outer-step-1', title: 'Run inner brain', status: STATUS.RUNNING },
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
