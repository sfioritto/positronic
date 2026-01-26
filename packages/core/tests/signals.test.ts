import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { createWebhook } from '../src/dsl/webhook.js';
import { createBrainExecutionMachine, sendEvent } from '../src/dsl/brain-state-machine.js';
import type { ResumeContext } from '../src/dsl/definitions/run-params.js';
import { MockSignalProvider } from './mock-signal-provider.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import type { ObjectGenerator } from '../src/clients/types.js';

// Mock ObjectGenerator with generateText support
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockGenerateText = jest.fn<NonNullable<ObjectGenerator['generateText']>>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
  streamText: mockStreamText,
};

describe('signal handling', () => {
  let signalProvider: MockSignalProvider;

  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockGenerateText.mockReset();
    signalProvider = new MockSignalProvider();
  });

  describe('KILL signal in main loop', () => {
    it('should terminate brain between steps when KILL signal is received', async () => {
      const testBrain = brain('test-kill')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }))
        .step('Step 3', () => ({ step3: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // Queue KILL signal after step 1 completes - will be picked up before step 2
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({ type: 'KILL' });
        }
      }

      // Should have CANCELLED event
      const cancelledEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.CANCELLED
      );
      expect(cancelledEvent).toBeDefined();
      expect(cancelledEvent?.status).toBe(STATUS.CANCELLED);

      // Should NOT have COMPLETE event
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeUndefined();

      // Only step 1 should complete (KILL is checked before step 2)
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(1);
    });
  });

  describe('PAUSE signal in main loop', () => {
    it('should pause brain between steps when PAUSE signal is received', async () => {
      const testBrain = brain('test-pause')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // Queue PAUSE signal after step 1 completes
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({ type: 'PAUSE' });
        }
      }

      // Should have PAUSED event
      const pausedEvent = events.find((e) => e.type === BRAIN_EVENTS.PAUSED);
      expect(pausedEvent).toBeDefined();
      expect(pausedEvent?.status).toBe(STATUS.PAUSED);

      // Should NOT have COMPLETE event
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeUndefined();

      // Only step 1 should complete
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(1);
    });
  });

  describe('KILL signal in agent loop', () => {
    it('should terminate agent mid-iteration when KILL signal is received', async () => {
      const lookupMock = jest
        .fn<(input: { id: string }) => Promise<{ id: string; found: boolean }>>()
        .mockResolvedValue({ id: '123', found: true });

      // First LLM call - calls a non-terminal tool to keep the loop going
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { id: '123' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      // This won't be reached because KILL signal will be processed
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'done',
            args: { result: 'done' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      const testBrain = brain('test-agent-kill').brain('Agent Step', () => ({
        prompt: 'Do something',
        tools: {
          lookup: {
            description: 'Lookup something',
            inputSchema: z.object({ id: z.string() }),
            execute: lookupMock,
          },
          done: {
            description: 'Mark as done',
            inputSchema: z.object({ result: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      let iterationCount = 0;

      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // After first iteration, queue KILL signal
        if (event.type === BRAIN_EVENTS.AGENT_ITERATION) {
          iterationCount++;
          if (iterationCount === 1) {
            signalProvider.queueSignal({ type: 'KILL' });
          }
        }
      }

      // Should have CANCELLED event
      const cancelledEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.CANCELLED
      );
      expect(cancelledEvent).toBeDefined();

      // Should have only 1 iteration (cancelled before second)
      const iterationEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      );
      expect(iterationEvents.length).toBe(1);

      // Should NOT have AGENT_COMPLETE
      const agentCompleteEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE
      );
      expect(agentCompleteEvent).toBeUndefined();
    });
  });

  describe('PAUSE signal in agent loop', () => {
    it('should pause agent mid-iteration when PAUSE signal is received', async () => {
      const lookupMock = jest
        .fn<(input: { id: string }) => Promise<{ id: string; found: boolean }>>()
        .mockResolvedValue({ id: '123', found: true });

      // First LLM call - calls a non-terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { id: '123' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      const testBrain = brain('test-agent-pause').brain('Agent Step', () => ({
        prompt: 'Do something',
        tools: {
          lookup: {
            description: 'Lookup something',
            inputSchema: z.object({ id: z.string() }),
            execute: lookupMock,
          },
          done: {
            description: 'Mark as done',
            inputSchema: z.object({ result: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      let iterationCount = 0;

      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // After first iteration, queue PAUSE signal
        if (event.type === BRAIN_EVENTS.AGENT_ITERATION) {
          iterationCount++;
          if (iterationCount === 1) {
            signalProvider.queueSignal({ type: 'PAUSE' });
          }
        }
      }

      // Should have PAUSED event
      const pausedEvent = events.find((e) => e.type === BRAIN_EVENTS.PAUSED);
      expect(pausedEvent).toBeDefined();
      expect(pausedEvent?.status).toBe(STATUS.PAUSED);

      // Should have only 1 iteration
      const iterationEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      );
      expect(iterationEvents.length).toBe(1);
    });
  });

  describe('USER_MESSAGE signal in agent loop', () => {
    it('should inject user message into agent conversation', async () => {
      const lookupMock = jest
        .fn<(input: { id: string }) => Promise<{ id: string; found: boolean }>>()
        .mockResolvedValue({ id: '123', found: true });

      // First LLM call - calls a non-terminal tool to keep loop going
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { id: '123' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [{ role: 'assistant', content: 'Looking up...' }],
      });

      // Second LLM call after user message injection
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'done',
            args: { result: 'done' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      const testBrain = brain('test-agent-message').brain(
        'Agent Step',
        () => ({
          prompt: 'Do something',
          tools: {
            lookup: {
              description: 'Lookup something',
              inputSchema: z.object({ id: z.string() }),
              execute: lookupMock,
            },
            done: {
              description: 'Mark as done',
              inputSchema: z.object({ result: z.string() }),
              terminal: true,
            },
          },
        })
      );

      const events: BrainEvent[] = [];
      let iterationCount = 0;

      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // After first iteration, queue USER_MESSAGE signal
        if (event.type === BRAIN_EVENTS.AGENT_ITERATION) {
          iterationCount++;
          if (iterationCount === 1) {
            signalProvider.queueSignal({
              type: 'USER_MESSAGE',
              content: 'Please hurry up!',
            });
          }
        }
      }

      // Should have AGENT_USER_MESSAGE event
      const userMessageEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_USER_MESSAGE
      );
      expect(userMessageEvent).toBeDefined();
      expect((userMessageEvent as any).content).toBe('Please hurry up!');

      // Should have 2 iterations
      const iterationEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      );
      expect(iterationEvents.length).toBe(2);

      // Should have AGENT_COMPLETE
      const agentCompleteEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE
      );
      expect(agentCompleteEvent).toBeDefined();

      // Verify that the second generateText call included the user message
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('signal priority', () => {
    it('should process KILL before PAUSE when both are queued', async () => {
      const testBrain = brain('test-priority')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // Queue signals in reverse priority order after step 1
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({ type: 'PAUSE' });
          signalProvider.queueSignal({ type: 'KILL' });
        }
      }

      // Should have CANCELLED (from KILL), not PAUSED
      const cancelledEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.CANCELLED
      );
      expect(cancelledEvent).toBeDefined();

      const pausedEvent = events.find((e) => e.type === BRAIN_EVENTS.PAUSED);
      expect(pausedEvent).toBeUndefined();
    });

    it('should process PAUSE before USER_MESSAGE when both are queued', async () => {
      const lookupMock = jest
        .fn<(input: { id: string }) => Promise<{ id: string; found: boolean }>>()
        .mockResolvedValue({ id: '123', found: true });

      // First LLM call - calls a non-terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { id: '123' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      const testBrain = brain('test-priority-2').brain('Agent Step', () => ({
        prompt: 'Do something',
        tools: {
          lookup: {
            description: 'Lookup something',
            inputSchema: z.object({ id: z.string() }),
            execute: lookupMock,
          },
          done: {
            description: 'Mark as done',
            inputSchema: z.object({ result: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      let iterationCount = 0;

      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // After first iteration, queue both signals
        if (event.type === BRAIN_EVENTS.AGENT_ITERATION) {
          iterationCount++;
          if (iterationCount === 1) {
            signalProvider.queueSignal({
              type: 'USER_MESSAGE',
              content: 'test',
            });
            signalProvider.queueSignal({ type: 'PAUSE' });
          }
        }
      }

      // Should have PAUSED (processed first due to priority)
      const pausedEvent = events.find((e) => e.type === BRAIN_EVENTS.PAUSED);
      expect(pausedEvent).toBeDefined();

      // Should NOT have AGENT_USER_MESSAGE (PAUSE stops execution)
      const userMessageEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_USER_MESSAGE
      );
      expect(userMessageEvent).toBeUndefined();
    });
  });

  describe('no signal provider', () => {
    it('should run normally when no signal provider is set', async () => {
      const testBrain = brain('test-no-signals')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        // No signalProvider
      })) {
        events.push(event);
      }

      // Should complete normally
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();

      // Should have 2 step completions
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(2);
    });
  });

  describe('USER_MESSAGE to non-agent brain', () => {
    it('should ignore USER_MESSAGE signals in non-agent steps (main loop only checks CONTROL signals)', async () => {
      const testBrain = brain('test-message-no-agent')
        .step('Step 1', () => ({ step1: true }))
        .step('Step 2', () => ({ step2: true }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // Queue USER_MESSAGE after step 1
        if (
          event.type === BRAIN_EVENTS.STEP_COMPLETE &&
          (event as any).stepTitle === 'Step 1'
        ) {
          signalProvider.queueSignal({
            type: 'USER_MESSAGE',
            content: 'Hello agent!',
          });
        }
      }

      // Brain should complete normally (USER_MESSAGE ignored in main loop)
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.COMPLETE
      );
      expect(completeEvent).toBeDefined();

      // Should NOT have AGENT_USER_MESSAGE event (no agent to receive it)
      const userMessageEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_USER_MESSAGE
      );
      expect(userMessageEvent).toBeUndefined();

      // Both steps should complete
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );
      expect(stepCompleteEvents.length).toBe(2);
    });
  });

  describe('USER_MESSAGE preservation during webhook resume', () => {
    it('should preserve USER_MESSAGE signals when resuming from webhook', async () => {
      // This test verifies that USER_MESSAGE signals queued while the brain
      // is waiting for a webhook are NOT lost when the webhook response arrives.
      // The fix: only consume WEBHOOK_RESPONSE signals during resume, leaving
      // USER_MESSAGE signals in the queue for the agent loop to process.

      const supportWebhook = createWebhook(
        'support-response',
        z.object({ response: z.string() }),
        async () => ({
          type: 'webhook' as const,
          identifier: 'ticket-123',
          response: { response: 'Support response' },
        })
      );

      // First LLM call: calls escalate tool which triggers webhook
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'escalate',
            args: { summary: 'Need help' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [
          { role: 'assistant', content: 'Escalating...' },
        ],
      });

      const testBrain = brain('test-webhook-message').brain(
        'Handle Request',
        () => ({
          prompt: 'Handle the request',
          tools: {
            escalate: {
              description: 'Escalate to support',
              inputSchema: z.object({ summary: z.string() }),
              execute: async () => ({
                waitFor: supportWebhook('ticket-123'),
              }),
            },
            resolve: {
              description: 'Resolve the issue',
              inputSchema: z.object({ resolution: z.string() }),
              terminal: true,
            },
          },
        })
      );

      // First run - should stop at webhook
      const firstRunEvents: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        firstRunEvents.push(event);
      }

      // Verify we hit the webhook
      expect(firstRunEvents.some((e) => e.type === BRAIN_EVENTS.WEBHOOK)).toBe(true);

      // Build resumeContext from the execution stack
      const startEvent = firstRunEvents.find((e) => e.type === BRAIN_EVENTS.START) as any;
      const brainRunId = startEvent.brainRunId;

      // Use state machine to reconstruct context
      const machine = createBrainExecutionMachine({
        events: firstRunEvents as unknown as Array<{ type: string } & Record<string, unknown>>,
      });
      const executionStack = machine.context.executionStack;

      // Build resume context with agent context from the state machine
      const webhookResponse = { response: 'Support said to do X' };
      const agentContext = machine.context.agentContext
        ? { ...machine.context.agentContext, webhookResponse }
        : null;

      function toResumeContext(stack: typeof executionStack): ResumeContext {
        let context: ResumeContext | undefined;
        for (let i = stack.length - 1; i >= 0; i--) {
          const entry = stack[i];
          if (i === stack.length - 1) {
            context = {
              stepIndex: entry.stepIndex,
              state: entry.state,
              webhookResponse,
              agentContext: agentContext ?? undefined,
            };
          } else {
            context = {
              stepIndex: entry.stepIndex,
              state: entry.state,
              innerResumeContext: context,
            };
          }
        }
        return context!;
      }

      const resumeContext = toResumeContext(executionStack);

      // Set up mock for the resumed agent loop
      // Second call after resumption with user message: should process message and call terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'resolve',
            args: { resolution: 'Called them banana as requested!' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [],
      });

      // Create signal provider with BOTH webhook response AND user message
      // This simulates the scenario where user sends a message while brain is waiting
      const resumeSignalProvider = new MockSignalProvider();
      resumeSignalProvider.queueSignal({
        type: 'WEBHOOK_RESPONSE',
        response: webhookResponse,
      });
      resumeSignalProvider.queueSignal({
        type: 'USER_MESSAGE',
        content: 'Call them banana as a joke!',
      });

      // Resume the brain - the USER_MESSAGE should be preserved and processed
      const resumeEvents: BrainEvent[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        resumeContext,
        brainRunId,
        signalProvider: resumeSignalProvider,
      })) {
        resumeEvents.push(event);
      }

      // THE KEY ASSERTION: USER_MESSAGE should have been processed by the agent loop
      const userMessageEvents = resumeEvents.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_USER_MESSAGE
      );
      expect(userMessageEvents.length).toBe(1);
      expect((userMessageEvents[0] as any).content).toBe('Call them banana as a joke!');

      // Brain should complete successfully
      expect(resumeEvents.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    });
  });

  describe('multiple USER_MESSAGE signals', () => {
    it('should process all queued USER_MESSAGE signals in a single iteration', async () => {
      const lookupMock = jest
        .fn<(input: { id: string }) => Promise<{ id: string; found: boolean }>>()
        .mockResolvedValue({ id: '123', found: true });

      // First LLM call - calls a non-terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { id: '123' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [{ role: 'assistant', content: 'Looking up...' }],
      });

      // Second LLM call after messages injection
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'done',
            args: { result: 'done' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      const testBrain = brain('test-multi-message').brain('Agent Step', () => ({
        prompt: 'Do something',
        tools: {
          lookup: {
            description: 'Lookup something',
            inputSchema: z.object({ id: z.string() }),
            execute: lookupMock,
          },
          done: {
            description: 'Mark as done',
            inputSchema: z.object({ result: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      let iterationCount = 0;

      for await (const event of testBrain.run({
        client: mockClient,
        signalProvider,
      })) {
        events.push(event);

        // After first iteration, queue multiple USER_MESSAGE signals
        if (event.type === BRAIN_EVENTS.AGENT_ITERATION) {
          iterationCount++;
          if (iterationCount === 1) {
            signalProvider.queueSignal({
              type: 'USER_MESSAGE',
              content: 'Message 1',
            });
            signalProvider.queueSignal({
              type: 'USER_MESSAGE',
              content: 'Message 2',
            });
            signalProvider.queueSignal({
              type: 'USER_MESSAGE',
              content: 'Message 3',
            });
          }
        }
      }

      // Should have 3 AGENT_USER_MESSAGE events (one for each message)
      const userMessageEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_USER_MESSAGE
      );
      expect(userMessageEvents.length).toBe(3);
      expect((userMessageEvents[0] as any).content).toBe('Message 1');
      expect((userMessageEvents[1] as any).content).toBe('Message 2');
      expect((userMessageEvents[2] as any).content).toBe('Message 3');

      // Should complete successfully
      const agentCompleteEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE
      );
      expect(agentCompleteEvent).toBeDefined();
    });
  });
});
