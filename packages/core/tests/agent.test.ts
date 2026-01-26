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
  type AgentIterationLimitEvent,
  type AgentWebhookEvent,
  type WebhookResponseEvent,
  type ResumeContext,
} from '../src/dsl/brain.js';
import type { AgentRawResponseMessageEvent } from '../src/dsl/definitions/events.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import type { ObjectGenerator, ToolMessage } from '../src/clients/types.js';
import { createWebhook } from '../src/dsl/webhook.js';
import { createBrainExecutionMachine } from '../src/dsl/brain-state-machine.js';

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
    mockGenerateObject.mockReset();
    mockGenerateText.mockReset();
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
        responseMessages: [],
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
      expect(agentCompleteEvent.totalTokens).toBe(100);

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
        responseMessages: [],
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
        responseMessages: [],
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
        responseMessages: [],
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
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: 'Still working...',
          toolCalls: [
            { toolCallId: 'call-2', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 400 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: 'More work...',
          toolCalls: [
            { toolCallId: 'call-3', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 400 },
          responseMessages: [],
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

  describe('agent with maxIterations limit', () => {
    it('should stop agent when maxIterations exceeded', async () => {
      // Each call returns a tool call, never completing
      mockGenerateText
        .mockResolvedValueOnce({
          text: 'Working...',
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: 'Still working...',
          toolCalls: [
            { toolCallId: 'call-2', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: 'More work...',
          toolCalls: [
            { toolCallId: 'call-3', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: 'Even more work...',
          toolCalls: [
            { toolCallId: 'call-4', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        });

      const testBrain = brain('test-max-iterations').brain('Long Task', () => ({
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
        maxIterations: 3, // Limit at 3 iterations
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Should emit iteration limit event
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_ITERATION_LIMIT)).toBe(
        true
      );

      const iterationLimitEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION_LIMIT
      ) as AgentIterationLimitEvent;
      expect(iterationLimitEvent.iteration).toBe(3);
      expect(iterationLimitEvent.maxIterations).toBe(3);
      expect(iterationLimitEvent.totalTokens).toBe(150); // 3 iterations * 50 tokens

      // Agent should still complete
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    });

    it('should use default maxIterations of 100', async () => {
      // Verify default by checking iteration count
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'done', args: {} },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

      const testBrain = brain('test-default-max-iterations').brain('Task', () => ({
        prompt: 'Do something',
        tools: {
          done: {
            description: 'Done',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
        // No maxIterations specified - should default to 100
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Should complete normally (1 iteration < 100 default)
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE)).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.AGENT_ITERATION_LIMIT)).toBe(false);
    });
  });

  describe('agent iteration event includes token info', () => {
    it('should include tokensThisIteration and totalTokens in iteration events', async () => {
      mockGenerateText
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'doWork', args: {} },
          ],
          usage: { totalTokens: 100 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            { toolCallId: 'call-2', toolName: 'done', args: {} },
          ],
          usage: { totalTokens: 150 },
          responseMessages: [],
        });

      const testBrain = brain('test-iteration-tokens').brain('Task', () => ({
        prompt: 'Do task',
        tools: {
          doWork: {
            description: 'Do work',
            inputSchema: z.object({}),
            execute: async () => 'done',
          },
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

      const iterationEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      ) as AgentIterationEvent[];

      expect(iterationEvents.length).toBe(2);

      // First iteration
      expect(iterationEvents[0].iteration).toBe(1);
      expect(iterationEvents[0].tokensThisIteration).toBe(100);
      expect(iterationEvents[0].totalTokens).toBe(100);

      // Second iteration
      expect(iterationEvents[1].iteration).toBe(2);
      expect(iterationEvents[1].tokensThisIteration).toBe(150);
      expect(iterationEvents[1].totalTokens).toBe(250);

      // Agent complete should also have totalTokens
      const completeEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.AGENT_COMPLETE
      ) as AgentCompleteEvent;
      expect(completeEvent.totalTokens).toBe(250);
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
        responseMessages: [],
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
        responseMessages: [],
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
        responseMessages: [],
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
      expect(systemPrompt).toContain('## You Are a Positronic Brain');
      expect(systemPrompt).toContain('You are a helpful assistant.');
      // Default should come first
      expect(systemPrompt.indexOf('## You Are a Positronic Brain')).toBeLessThan(
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
        responseMessages: [],
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
      expect(callArgs.system).toContain('## You Are a Positronic Brain');
      expect(callArgs.system).toContain('MUST use tool calls');
      expect(callArgs.system).toContain('## Tool Execution');
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
        responseMessages: [],
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
        responseMessages: [
          { role: 'user', content: 'Do task' },
          { role: 'assistant', content: 'Thinking...' },
        ],
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
        BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE, // raw LLM response captured (single message)
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

  describe('agent raw response message event', () => {
    it('should emit agent:raw_response_message for each message', async () => {
      mockGenerateText
        .mockResolvedValueOnce({
          text: 'Thinking...',
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'doWork', args: { task: 'test' } },
          ],
          usage: { totalTokens: 100 },
          responseMessages: [
            { role: 'user', content: 'Do task' },
            { role: 'assistant', content: 'Thinking...' },
          ],
        })
        .mockResolvedValueOnce({
          text: 'Done!',
          toolCalls: [
            { toolCallId: 'call-2', toolName: 'done', args: { result: 'completed' } },
          ],
          usage: { totalTokens: 150 },
          responseMessages: [
            { role: 'user', content: 'Do task' },
            { role: 'assistant', content: 'Thinking...' },
            { role: 'tool', toolCallId: 'call-1', content: 'work done' },
            { role: 'assistant', content: 'Done!' },
          ],
        });

      const doWorkMock = jest.fn<() => Promise<string>>().mockResolvedValue('work done');

      // Add createToolResultMessage to mock client
      const mockClientWithToolResult = {
        ...mockClient,
        createToolResultMessage: (toolCallId: string, toolName: string, result: unknown) => ({
          role: 'tool',
          toolCallId,
          toolName,
          content: result,
        }),
      };

      const testBrain = brain('test-raw-response').brain('Task', () => ({
        prompt: 'Do task',
        tools: {
          doWork: {
            description: 'Do work',
            inputSchema: z.object({ task: z.string() }),
            execute: doWorkMock,
          },
        },
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClientWithToolResult })) {
        events.push(event);
      }

      // Find raw response events
      const rawResponseEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE
      ) as AgentRawResponseMessageEvent[];

      // Now we emit one event per message:
      // - First iteration: 1 assistant message
      // - After tool execution: 1 tool result message
      // - Second iteration: 1 assistant message
      // Total: 3 messages
      expect(rawResponseEvents.length).toBe(3);

      // First message event (assistant from first iteration)
      expect(rawResponseEvents[0].iteration).toBe(1);
      expect((rawResponseEvents[0].message as any).role).toBe('assistant');

      // Second message event (tool result)
      expect(rawResponseEvents[1].iteration).toBe(1);
      expect((rawResponseEvents[1].message as any).role).toBe('tool');

      // Third message event (assistant from second iteration)
      expect(rawResponseEvents[2].iteration).toBe(2);
      expect((rawResponseEvents[2].message as any).role).toBe('assistant');
    });

    it('should emit raw response before iteration event', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          { toolCallId: 'call-1', toolName: 'done', args: {} },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [
          { role: 'user', content: [{ type: 'text', text: 'Do task' }] },
          { role: 'assistant', content: 'Done' },
        ],
      });

      const testBrain = brain('test-event-order-raw').brain('Task', () => ({
        prompt: 'Do task',
      }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      const rawResponseIndex = events.findIndex(
        (e) => e.type === BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE
      );
      const iterationIndex = events.findIndex(
        (e) => e.type === BRAIN_EVENTS.AGENT_ITERATION
      );

      // Raw response should come before iteration
      expect(rawResponseIndex).toBeGreaterThan(-1);
      expect(iterationIndex).toBeGreaterThan(-1);
      expect(rawResponseIndex).toBeLessThan(iterationIndex);
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
        responseMessages: [],
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
        responseMessages: [],
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
        text: 'I need to escalate this',
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'escalate',
            args: { reason: 'Need approval' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [
          { role: 'user', content: 'Handle the request' },
          { role: 'assistant', content: 'I need to escalate this' },
        ],
      });

      // Second call (after resumption): LLM calls terminal tool
      mockGenerateText.mockResolvedValueOnce({
        text: 'Completing the request',
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'complete',
            args: { result: 'Approved and completed' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [
          { role: 'user', content: 'Handle the request' },
          { role: 'assistant', content: 'I need to escalate this' },
          { role: 'tool', content: 'Approved' },
          { role: 'assistant', content: 'Completing the request' },
        ],
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
      // Use the state machine to reconstruct agent context from events
      const webhookResponse = { ticketId: 'ticket-456', approved: true };
      const machine = createBrainExecutionMachine({
        events: events as unknown as Array<{ type: string } & Record<string, unknown>>,
      });
      const agentContext = machine.context.agentContext
        ? { ...machine.context.agentContext, webhookResponse }
        : null;
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

      // Get the brain run ID from the START event
      const startEvent = events.find((e) => e.type === BRAIN_EVENTS.START) as any;
      const brainRunId = startEvent.brainRunId;

      // Build resumeContext from the execution stack
      const executionStack = machine.context.executionStack;

      // Helper to convert executionStack to ResumeContext (adds webhookResponse and agentContext at deepest level)
      function toResumeContext(stack: typeof executionStack): ResumeContext {
        let context: ResumeContext | undefined;
        for (let i = stack.length - 1; i >= 0; i--) {
          const entry = stack[i];
          if (i === stack.length - 1) {
            // Deepest level gets the webhook response and agent context
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

      // Resume the brain with the webhook response
      const resumeEvents: BrainEvent[] = [];
      for await (const event of resumedBrain.run({
        client: mockClient,
        resumeContext,
        brainRunId,
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

  describe('agent with outputSchema', () => {
    it('should namespace agent output under schema name', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'done',
            args: { summary: 'Done', score: 95 },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [],
      });

      const testBrain = brain('test-output-schema').brain('Process', {
        prompt: 'Analyze the data',
        outputSchema: {
          schema: z.object({ summary: z.string(), score: z.number() }),
          name: 'analysis' as const,
        },
      });

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify generated tool was available with 'done' name
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            done: expect.objectContaining({
              description: expect.stringContaining('analysis'),
            }),
          }),
        })
      );

      // Verify state was namespaced correctly
      let finalState: any = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      // Result under 'analysis' key, NOT spread at root
      expect(finalState).toEqual({
        analysis: { summary: 'Done', score: 95 },
      });
      expect(finalState.summary).toBeUndefined();
    });

    it('should work with config function pattern', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'done',
            args: { message: 'Hello back' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [],
      });

      const testBrain = brain('test-config-fn-output')
        .step('Init', () => ({ name: 'Alice' }))
        .brain('Greet', ({ state }) => ({
          prompt: `Greet ${state.name}`,
          outputSchema: {
            schema: z.object({ message: z.string() }),
            name: 'greeting' as const,
          },
        }));

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      let finalState: any = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      expect(finalState).toEqual({
        name: 'Alice',
        greeting: { message: 'Hello back' },
      });
    });

    it('should allow other terminal tools alongside outputSchema tool', async () => {
      // LLM calls user-defined terminal tool (abort) instead of generated one
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'abort',
            args: { reason: 'Invalid data' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [],
      });

      const testBrain = brain('test-multiple-terminal').brain('Process', {
        prompt: 'Process data',
        tools: {
          abort: {
            description: 'Abort processing',
            inputSchema: z.object({ reason: z.string() }),
            terminal: true,
          },
        },
        outputSchema: {
          schema: z.object({ result: z.string() }),
          name: 'output' as const,
        },
      });

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // User-defined terminal tool should spread at root (backward compatible)
      let finalState: any = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      // abort tool spreads at root, not under a key
      expect(finalState).toEqual({ reason: 'Invalid data' });
    });

    it('should work with subsequent steps that access the typed output', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'done',
            args: { entities: ['apple', 'banana'], count: 2 },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [],
      });

      const testBrain = brain('test-output-schema-flow')
        .brain('Extract', {
          prompt: 'Extract entities',
          outputSchema: {
            schema: z.object({
              entities: z.array(z.string()),
              count: z.number(),
            }),
            name: 'extracted' as const,
          },
        })
        .step('Process', ({ state }) => {
          // This step can access state.extracted with proper types
          return {
            ...state,
            processed: state.extracted.entities.join(', '),
            total: state.extracted.count,
          };
        });

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      let finalState: any = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      expect(finalState).toEqual({
        extracted: { entities: ['apple', 'banana'], count: 2 },
        processed: 'apple, banana',
        total: 2,
      });
    });

    it('should work with top-level brain() function', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'done',
            args: { userName: 'Alice', greeting: 'Welcome!' },
          },
        ],
        usage: { totalTokens: 100 },
        responseMessages: [],
      });

      // Using top-level brain() with config object directly (not .brain() step method)
      const testBrain = brain('direct-agent', {
        system: 'You are a friendly greeter',
        outputSchema: {
          schema: z.object({
            userName: z.string(),
            greeting: z.string(),
          }),
          name: 'welcome' as const,
        },
      });

      const events: BrainEvent[] = [];
      for await (const event of testBrain.run({ client: mockClient })) {
        events.push(event);
      }

      // Verify brain completed successfully
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Verify state was namespaced correctly
      let finalState: any = {};
      for (const event of events) {
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          finalState = applyPatches(finalState, [event.patch]);
        }
      }

      expect(finalState).toEqual({
        welcome: { userName: 'Alice', greeting: 'Welcome!' },
      });
    });
  });
});
