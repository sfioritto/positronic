import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import {
  brain,
  type BrainEvent,
  type AgentStartEvent,
  type AgentIterationEvent,
  type AgentToolCallEvent,
  type AgentToolResultEvent,
  type AgentCompleteEvent,
  type AgentTokenLimitEvent,
  type AgentWebhookEvent,
  type WebhookResponseEvent,
} from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import type { ObjectGenerator, ToolMessage } from '../src/clients/types.js';
import { createWebhook } from '../src/dsl/webhook.js';
import { reconstructAgentContext } from '../src/dsl/agent-messages.js';

// Mock ObjectGenerator with generateText support
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockGenerateText = jest.fn<NonNullable<ObjectGenerator['generateText']>>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
  streamText: mockStreamText,
};

describe('agent step', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
    mockGenerateText.mockClear();
  });

  describe('basic agent with terminal tool', () => {
    it('should complete when terminal tool is called', async () => {
      // Mock the LLM to call the terminal tool immediately
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'resolve',
            args: { resolution: 'Issue fixed' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-agent').brain(
        'Handle Request',
        ({ state }) => ({
          prompt: 'Handle this request',
          tools: {
            resolve: {
              description: 'Mark case resolved',
              inputSchema: z.object({ resolution: z.string() }),
              terminal: true,
            },
          },
        })
      );

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify events emitted
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_START)).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_ITERATION)).toBe(
        true
      );
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_TOOL_CALL)).toBe(
        true
      );
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE)).toBe(
        true
      );
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Verify agent complete event has correct data
      const agentCompleteEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE
      ) as AgentCompleteEvent;
      expect(agentCompleteEvent.terminalToolName).toBe('resolve');
      expect(agentCompleteEvent.result).toEqual({ resolution: 'Issue fixed' });

      // Verify final state has terminal tool result merged
      let finalState = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }
      expect(finalState).toEqual({ resolution: 'Issue fixed' });
    });
  });

  describe('agent with tool execution', () => {
    it('should execute non-terminal tools and continue agent', async () => {
      const lookupOrderMock = jest.fn<(input: { orderId: string }) => Promise<{ orderId: string; status: string }>>()
        .mockResolvedValue({ orderId: '123', status: 'shipped' });

      // First call: LLM calls lookupOrder tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookupOrder',
            args: { orderId: '123' },
          },
        ],
        usage: { totalTokens: 50 },
      });

      // Second call: LLM calls terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'resolve',
            args: { resolution: 'Order is shipped' },
          },
        ],
        usage: { totalTokens: 60 },
      });

      const testBrain = brain('test-agent-tools').brain(
        'Handle Order Request',
        () => ({
          prompt: 'Look up the order',
          tools: {
            lookupOrder: {
              description: 'Look up order details',
              inputSchema: z.object({ orderId: z.string() }),
              execute: lookupOrderMock,
            },
            resolve: {
              description: 'Mark case resolved',
              inputSchema: z.object({ resolution: z.string() }),
              terminal: true,
            },
          },
        })
      );

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify tool was executed with correct input (context is the second arg)
      expect(lookupOrderMock).toHaveBeenCalledWith(
        { orderId: '123' },
        expect.objectContaining({ client: expect.anything(), state: expect.anything() })
      );

      // Verify tool result event was emitted
      const toolResultEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_TOOL_RESULT
      ) as AgentToolResultEvent[];
      expect(toolResultEvents.length).toBe(1);
      expect(toolResultEvents[0].toolName).toBe('lookupOrder');
      expect(toolResultEvents[0].result).toEqual({ orderId: '123', status: 'shipped' });

      // Verify two iterations occurred
      const iterationEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      );
      expect(iterationEvents.length).toBe(2);

      // Verify generateText was called twice
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('agent ends when no tool calls', () => {
    it('should complete agent when LLM returns no tool calls', async () => {
      // LLM returns text but no tool calls
      mockGenerateText.mockResolvedValueOnce({
        text: 'I have completed the task.',
        toolCalls: undefined,
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-no-tools').brain('Simple Task', () => ({
        prompt: 'Do something',
        tools: {
          resolve: {
            description: 'Mark resolved',
            inputSchema: z.object({ resolution: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Agent should complete without AGENT_COMPLETE (that's for terminal tools)
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_START)).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_ITERATION)).toBe(
        true
      );
      expect(
        events.some((e) => e.type === BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE)
      ).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // No AGENT_COMPLETE since no terminal tool was called
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE)).toBe(
        false
      );
    });
  });

  describe('agent with maxTokens limit', () => {
    it('should stop agent when maxTokens exceeded', async () => {
      // Each call uses more tokens, eventually exceeding limit
      mockGenerateText
        .mockResolvedValueOnce({
          text: 'Working...',
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 400 },
        })
        .mockResolvedValueOnce({
          text: 'Still working...',
          toolCalls: [
            { toolCallId: 'call-2', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 400 },
        })
        .mockResolvedValueOnce({
          text: 'More work...',
          toolCalls: [
            { toolCallId: 'call-3', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 400 },
        });

      const testBrain = brain('test-max-tokens').brain('Long Task', () => ({
        prompt: 'Do lots of work',
        tools: {
          doWork: {
            description: 'Do some work',
            inputSchema: z.object({}),
            execute: async () => 'done',
          },
          resolve: {
            description: 'Finish',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
        maxTokens: 1000, // Limit at 1000 tokens
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Should emit token limit event
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_TOKEN_LIMIT)).toBe(
        true
      );

      const tokenLimitEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_TOKEN_LIMIT
      ) as AgentTokenLimitEvent;
      expect(tokenLimitEvent.totalTokens).toBeGreaterThanOrEqual(1000);

      // Agent should still complete
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    });
  });

  describe('agent with waitFor', () => {
    it('should emit WEBHOOK event when tool returns waitFor', async () => {
      const supportWebhook = createWebhook(
        'support-response',
        z.object({ ticketId: z.string(), response: z.string() }),
        async () => ({
          type: 'webhook' as const,
          identifier: 'ticket-123',
          response: { ticketId: 'ticket-123', response: 'Support response' },
        })
      );

      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'escalate',
            args: { summary: 'Customer needs help' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-waitfor').brain('Handle Escalation', () => ({
        prompt: 'Handle the request',
        tools: {
          escalate: {
            description: 'Escalate to support',
            inputSchema: z.object({ summary: z.string() }),
            execute: async () => {
              return {
                waitFor: supportWebhook('ticket-123'),
              };
            },
          },
          resolve: {
            description: 'Mark resolved',
            inputSchema: z.object({ resolution: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Should emit WEBHOOK event
      expect(events.some((e) => e.type === BRAIN_EVENTS.WEBHOOK)).toBe(true);

      const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK);
      expect(webhookEvent).toBeDefined();
    });

    it('should emit WEBHOOK event with multiple webhooks when tool returns array', async () => {
      const slackWebhook = createWebhook(
        'slack-response',
        z.object({ channel: z.string(), approved: z.boolean() }),
        async () => ({
          type: 'webhook' as const,
          identifier: 'slack-thread-1',
          response: { channel: '#approvals', approved: true },
        })
      );

      const emailWebhook = createWebhook(
        'email-response',
        z.object({ email: z.string(), approved: z.boolean() }),
        async () => ({
          type: 'webhook' as const,
          identifier: 'email-msg-1',
          response: { email: 'manager@example.com', approved: true },
        })
      );

      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'requestApproval',
            args: { reason: 'Budget increase needed' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-array-waitfor').brain('Multi-channel Approval', () => ({
        prompt: 'Request approval via multiple channels',
        tools: {
          requestApproval: {
            description: 'Request approval via Slack and email',
            inputSchema: z.object({ reason: z.string() }),
            execute: async () => {
              return {
                waitFor: [slackWebhook('slack-thread-1'), emailWebhook('email-msg-1')],
              };
            },
          },
          complete: {
            description: 'Complete the request',
            inputSchema: z.object({ result: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Should emit single AGENT_WEBHOOK event (captures tool context)
      const agentWebhookEvents = events.filter((e) => e.type === BRAIN_EVENTS.AGENT_WEBHOOK);
      expect(agentWebhookEvents.length).toBe(1);

      // Should emit WEBHOOK event with both webhooks
      const webhookEvent = events.find((e) => e.type === BRAIN_EVENTS.WEBHOOK) as any;
      expect(webhookEvent).toBeDefined();
      expect(webhookEvent.waitFor).toHaveLength(2);
      expect(webhookEvent.waitFor[0].slug).toBe('slack-response');
      expect(webhookEvent.waitFor[0].identifier).toBe('slack-thread-1');
      expect(webhookEvent.waitFor[1].slug).toBe('email-response');
      expect(webhookEvent.waitFor[1].identifier).toBe('email-msg-1');
    });
  });

  describe('agent throws when generateText not implemented', () => {
    it('should throw descriptive error when client lacks generateText', async () => {
      const clientWithoutGenerateText: ObjectGenerator = {
        generateObject: mockGenerateObject,
        streamText: mockStreamText,
        // No generateText
      };

      const testBrain = brain('test-no-generate-text').brain(
        'Will Fail',
        () => ({
          prompt: 'Test',
          tools: {
            resolve: {
              description: 'Resolve',
              inputSchema: z.object({}),
              terminal: true,
            },
          },
        })
      );

      // The error is thrown and caught, emitting an error event
      // But the iteration continues, so we need to catch it
      let caughtError: Error | null = null;
      const events: BrainEvent[] = [];

      try {
        for await (const event of testBrain.run({
          client: clientWithoutGenerateText,
        })) {
          events.push(event);
        }
      } catch (error) {
        caughtError = error as Error;
      }

      // Error should be thrown directly (not via event) for this case
      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toContain('generateText');
    });
  });

  describe('agent with system prompt', () => {
    it('should prepend default system prompt and append user system prompt', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'done',
            args: {},
          },
        ],
        usage: { totalTokens: 50 },
      });

      const testBrain = brain('test-system').brain('With System', () => ({
        system: 'You are a helpful assistant.',
        prompt: 'Help the user',
        tools: {
          done: {
            description: 'Done',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify system prompt includes both default and user's prompt
      const callArgs = mockGenerateText.mock.calls[0][0];
      expect(callArgs.system).toBeDefined();
      const systemPrompt = callArgs.system!;
      expect(systemPrompt).toContain('## Tool Execution Behavior');
      expect(systemPrompt).toContain('You are a helpful assistant.');
      // Default should come first
      expect(systemPrompt.indexOf('## Tool Execution Behavior')).toBeLessThan(
        systemPrompt.indexOf('You are a helpful assistant.')
      );
    });

    it('should use default system prompt when none provided', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'done',
            args: {},
          },
        ],
        usage: { totalTokens: 50 },
      });

      const testBrain = brain('test-default-system').brain('No System', () => ({
        prompt: 'Do something',
        tools: {
          done: {
            description: 'Done',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify default system prompt is used
      const callArgs = mockGenerateText.mock.calls[0][0];
      expect(callArgs.system).toContain('## Tool Execution Behavior');
      expect(callArgs.system).toContain('Tools are executed sequentially');
      expect(callArgs.system).toContain('webhook');
    });
  });

  describe('agent with state access', () => {
    it('should have access to prior step state in config function', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'respond',
            args: { message: 'Hello back!' },
          },
        ],
        usage: { totalTokens: 50 },
      });

      const testBrain = brain('test-state-access')
        .step('Init', () => ({ customerName: 'Alice', issue: 'Login problem' }))
        .brain('Respond', ({ state }) => ({
          prompt: `Help ${state.customerName} with: ${state.issue}`,
          tools: {
            respond: {
              description: 'Send response',
              inputSchema: z.object({ message: z.string() }),
              terminal: true,
            },
          },
        }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify prompt includes state values
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Help Alice with: Login problem',
            }),
          ]),
        })
      );

      // Verify final state has both init step and agent result
      let finalState = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }
      expect(finalState).toEqual({
        customerName: 'Alice',
        issue: 'Login problem',
        message: 'Hello back!',
      });
    });
  });

  describe('event sequence', () => {
    it('should emit events in correct order', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: 'Thinking...',
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'done', args: { result: 'ok' } },
        ],
        usage: { totalTokens: 50 },
      });

      const testBrain = brain('test-event-order').brain('Task', () => ({
        prompt: 'Do task',
        tools: {
          done: {
            description: 'Done',
            inputSchema: z.object({ result: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      const eventTypes = events.map((e) => e.type);

      // Verify order (includes STEP_STATUS for 'running' before agent)
      expect(eventTypes).toEqual([
        BRAIN_EVENTS.START,
        BRAIN_EVENTS.STEP_STATUS, // pending -> running
        BRAIN_EVENTS.STEP_START,
        BRAIN_EVENTS.STEP_STATUS, // running status during step
        BRAIN_EVENTS.AGENT_START,
        BRAIN_EVENTS.AGENT_ITERATION,
        BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
        BRAIN_EVENTS.AGENT_TOOL_CALL,
        BRAIN_EVENTS.AGENT_COMPLETE,
        BRAIN_EVENTS.STEP_COMPLETE,
        BRAIN_EVENTS.STEP_STATUS, // running -> complete
        BRAIN_EVENTS.COMPLETE,
      ]);
    });
  });

  describe('agent webhook resumption', () => {
    it('should include prompt and system in AGENT_START event', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'resolve',
            args: { resolution: 'Done' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-agent-start').brain('Handle', () => ({
        prompt: 'Handle the request',
        system: 'You are a helpful assistant',
        tools: {
          resolve: {
            description: 'Resolve',
            inputSchema: z.object({ resolution: z.string() }),
            terminal: true,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      const agentStartEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_START
      ) as AgentStartEvent;
      expect(agentStartEvent).toBeDefined();
      expect(agentStartEvent.prompt).toBe('Handle the request');
      expect(agentStartEvent.system).toBe('You are a helpful assistant');
    });

    it('should emit AGENT_WEBHOOK before WEBHOOK when tool returns waitFor', async () => {
      const supportWebhook = createWebhook(
        'support-response',
        z.object({ ticketId: z.string(), response: z.string() }),
        async () => ({
          type: 'webhook' as const,
          identifier: 'ticket-123',
          response: { ticketId: 'ticket-123', response: 'Support response' },
        })
      );

      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'escalate',
            args: { summary: 'Customer needs help' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-agent-webhook').brain(
        'Handle Escalation',
        () => ({
          prompt: 'Handle the request',
          tools: {
            escalate: {
              description: 'Escalate to support',
              inputSchema: z.object({ summary: z.string() }),
              execute: async () => {
                return {
                  waitFor: supportWebhook('ticket-123'),
                };
              },
            },
            resolve: {
              description: 'Mark resolved',
              inputSchema: z.object({ resolution: z.string() }),
              terminal: true,
            },
          },
        })
      );

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Should emit AGENT_WEBHOOK before WEBHOOK
      const agentWebhookIndex = events.findIndex(
        (e) => e.type === BRAIN_EVENTS.AGENT_WEBHOOK
      );
      const webhookIndex = events.findIndex(
        (e) => e.type === BRAIN_EVENTS.WEBHOOK
      );

      expect(agentWebhookIndex).toBeGreaterThan(-1);
      expect(webhookIndex).toBeGreaterThan(-1);
      expect(agentWebhookIndex).toBeLessThan(webhookIndex);

      // Verify AGENT_WEBHOOK has correct tool info
      const agentWebhookEvent = events[agentWebhookIndex] as AgentWebhookEvent;
      expect(agentWebhookEvent.toolCallId).toBe('call-1');
      expect(agentWebhookEvent.toolName).toBe('escalate');
      expect(agentWebhookEvent.input).toEqual({ summary: 'Customer needs help' });
    });

    describe('reconstructAgentContext', () => {
      it('should return null when no AGENT_WEBHOOK event exists', () => {
        const events: BrainEvent[] = [
          {
            type: BRAIN_EVENTS.AGENT_START,
            stepTitle: 'Test',
            stepId: 'step-1',
            prompt: 'Hello',
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_COMPLETE,
            stepTitle: 'Test',
            stepId: 'step-1',
            terminalToolName: 'resolve',
            result: {},
            totalIterations: 1,
            options: {},
            brainRunId: 'run-1',
          },
        ];

        const result = reconstructAgentContext(events, { response: 'test' });
        expect(result).toBeNull();
      });

      it('should reconstruct messages from AGENT events', () => {
        const events: BrainEvent[] = [
          {
            type: BRAIN_EVENTS.AGENT_START,
            stepTitle: 'Test',
            stepId: 'step-1',
            prompt: 'Handle the request',
            system: 'You are helpful',
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_ITERATION,
            stepTitle: 'Test',
            stepId: 'step-1',
            iteration: 1,
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
            stepTitle: 'Test',
            stepId: 'step-1',
            content: 'Let me help you with that',
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_TOOL_CALL,
            stepTitle: 'Test',
            stepId: 'step-1',
            toolCallId: 'call-1',
            toolName: 'search',
            input: { query: 'test' },
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
            stepTitle: 'Test',
            stepId: 'step-1',
            toolCallId: 'call-1',
            toolName: 'search',
            result: { found: true },
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_TOOL_CALL,
            stepTitle: 'Test',
            stepId: 'step-1',
            toolCallId: 'call-2',
            toolName: 'escalate',
            input: { summary: 'Need approval' },
            options: {},
            brainRunId: 'run-1',
          },
          {
            type: BRAIN_EVENTS.AGENT_WEBHOOK,
            stepTitle: 'Test',
            stepId: 'step-1',
            toolCallId: 'call-2',
            toolName: 'escalate',
            input: { summary: 'Need approval' },
            options: {},
            brainRunId: 'run-1',
          },
        ];

        const webhookResponse = { approved: true, comment: 'Looks good' };
        const result = reconstructAgentContext(events, webhookResponse);

        expect(result).not.toBeNull();
        expect(result!.prompt).toBe('Handle the request');
        expect(result!.system).toBe('You are helpful');
        expect(result!.pendingToolCallId).toBe('call-2');
        expect(result!.pendingToolName).toBe('escalate');

        // Check messages array
        expect(result!.messages).toHaveLength(4);

        // First message: initial user prompt
        expect(result!.messages[0]).toEqual({
          role: 'user',
          content: 'Handle the request',
        });

        // Second message: assistant response
        expect(result!.messages[1]).toEqual({
          role: 'assistant',
          content: 'Let me help you with that',
        });

        // Third message: first tool result
        expect(result!.messages[2]).toEqual({
          role: 'tool',
          content: JSON.stringify({ found: true }),
          toolCallId: 'call-1',
          toolName: 'search',
        });

        // Fourth message: webhook response as tool result
        expect(result!.messages[3]).toEqual({
          role: 'tool',
          content: JSON.stringify(webhookResponse),
          toolCallId: 'call-2',
          toolName: 'escalate',
        });
      });
    });

    it('should not pass webhook response as response parameter to config function on resumption', async () => {
      // This test verifies that the agent config function receives the previous step's
      // response (not the webhook response) when resuming from a webhook.
      // The webhook response should only be available via the messages array.

      const configFnCalls: Array<{ response: any }> = [];

      const supportWebhook = createWebhook(
        'support-response',
        z.object({ ticketId: z.string(), approved: z.boolean() }),
        async () => ({
          type: 'webhook' as const,
          identifier: 'ticket-456',
          response: { ticketId: 'ticket-456', approved: true },
        })
      );

      // First call: LLM calls escalate tool which triggers webhook
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'escalate',
            args: { reason: 'Need approval' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      // Second call (after resumption): LLM calls terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'complete',
            args: { result: 'Approved and completed' },
          },
        ],
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-config-response')
        .step('Init', () => ({ previousStepData: 'from-init-step' }))
        .brain('Handle Request', ({ state, response }) => {
          // Capture what response is each time config function is called
          configFnCalls.push({ response });

          return {
            prompt: 'Handle the request',
            tools: {
              escalate: {
                description: 'Escalate for approval',
                inputSchema: z.object({ reason: z.string() }),
                execute: async () => ({
                  waitFor: supportWebhook('ticket-456'),
                }),
              },
              complete: {
                description: 'Complete the request',
                inputSchema: z.object({ result: z.string() }),
                terminal: true,
              },
            },
          };
        });

      // Run until webhook pause
      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify we paused on webhook
      expect(events.some((e) => e.type === BRAIN_EVENTS.WEBHOOK)).toBe(true);

      // Config function should have been called once (initial start)
      expect(configFnCalls.length).toBe(1);
      // On initial start, response should be undefined (no previous response from Init step
      // because the step just sets state, doesn't return a "response" in the generateObject sense)
      expect(configFnCalls[0].response).toBeUndefined();

      // Now resume from webhook with a webhook response
      const webhookResponse = { ticketId: 'ticket-456', approved: true };
      const agentContext = reconstructAgentContext(events, webhookResponse);
      expect(agentContext).not.toBeNull();

      // Create a new brain instance to resume
      const resumedBrain = brain('test-config-response')
        .step('Init', () => ({ previousStepData: 'from-init-step' }))
        .brain('Handle Request', ({ state, response }) => {
          // Capture what response is on resumption
          configFnCalls.push({ response });

          return {
            prompt: 'Handle the request',
            tools: {
              escalate: {
                description: 'Escalate for approval',
                inputSchema: z.object({ reason: z.string() }),
                execute: async () => ({
                  waitFor: supportWebhook('ticket-456'),
                }),
              },
              complete: {
                description: 'Complete the request',
                inputSchema: z.object({ result: z.string() }),
                terminal: true,
              },
            },
          };
        });

      // Get step completion events to reconstruct state
      const stepCompleteEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.STEP_COMPLETE
      );

      // Get the brain run ID from the START event
      const startEvent = events.find((e) => e.type === BRAIN_EVENTS.START) as any;
      const brainRunId = startEvent.brainRunId;

      // Resume the brain with the webhook response
      const resumeEvents: BrainEvent[] = [];
      for await (const event of resumedBrain.run({
        client: mockClient,
        response: webhookResponse,
        agentResumeContext: agentContext!,
        initialState: {},
        brainRunId,
        initialCompletedSteps: stepCompleteEvents.map((e: any) => ({
          id: e.stepId,
          title: e.stepTitle,
          status: STATUS.COMPLETE,
          patch: e.patch,
        })),
      })) {
        resumeEvents.push(event);
      }

      // Verify brain completed
      expect(resumeEvents.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Config function should have been called again on resumption
      expect(configFnCalls.length).toBe(2);

      // THE KEY ASSERTION: On resumption, response should NOT be the webhook data
      // It should be undefined (same as on initial start), because the config function
      // is for setting up the agent, not for processing webhook responses.
      // Webhook responses flow through the messages array, not the response parameter.
      expect(configFnCalls[1].response).toBeUndefined();
      expect(configFnCalls[1].response).not.toEqual(webhookResponse);
    });
  });
});
