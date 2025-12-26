import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { applyPatches } from '../src/dsl/json-patch.js';
import {
  brain,
  type BrainEvent,
  type LoopStartEvent,
  type LoopIterationEvent,
  type LoopToolCallEvent,
  type LoopToolResultEvent,
  type LoopCompleteEvent,
  type LoopTokenLimitEvent,
} from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import type { ObjectGenerator, ToolMessage } from '../src/clients/types.js';
import { createWebhook } from '../src/dsl/webhook.js';

// Mock ObjectGenerator with generateText support
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockGenerateText = jest.fn<NonNullable<ObjectGenerator['generateText']>>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
};

describe('loop step', () => {
  beforeEach(() => {
    mockGenerateObject.mockClear();
    mockGenerateText.mockClear();
  });

  describe('basic loop with terminal tool', () => {
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

      const testBrain = brain('test-loop').loop(
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
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_START)).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_ITERATION)).toBe(
        true
      );
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_TOOL_CALL)).toBe(
        true
      );
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_COMPLETE)).toBe(
        true
      );
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Verify loop complete event has correct data
      const loopCompleteEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.LOOP_COMPLETE
      ) as LoopCompleteEvent;
      expect(loopCompleteEvent.terminalToolName).toBe('resolve');
      expect(loopCompleteEvent.result).toEqual({ resolution: 'Issue fixed' });

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

  describe('loop with tool execution', () => {
    it('should execute non-terminal tools and continue loop', async () => {
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

      const testBrain = brain('test-loop-tools').loop(
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

      // Verify tool was executed
      expect(lookupOrderMock).toHaveBeenCalledWith({ orderId: '123' });

      // Verify tool result event was emitted
      const toolResultEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.LOOP_TOOL_RESULT
      ) as LoopToolResultEvent[];
      expect(toolResultEvents.length).toBe(1);
      expect(toolResultEvents[0].toolName).toBe('lookupOrder');
      expect(toolResultEvents[0].result).toEqual({ orderId: '123', status: 'shipped' });

      // Verify two iterations occurred
      const iterationEvents = events.filter(
        (e) => e.type === BRAIN_EVENTS.LOOP_ITERATION
      );
      expect(iterationEvents.length).toBe(2);

      // Verify generateText was called twice
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('loop ends when no tool calls', () => {
    it('should complete loop when LLM returns no tool calls', async () => {
      // LLM returns text but no tool calls
      mockGenerateText.mockResolvedValueOnce({
        text: 'I have completed the task.',
        toolCalls: undefined,
        usage: { totalTokens: 100 },
      });

      const testBrain = brain('test-no-tools').loop('Simple Task', () => ({
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

      // Loop should complete without LOOP_COMPLETE (that's for terminal tools)
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_START)).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_ITERATION)).toBe(
        true
      );
      expect(
        events.some((e) => e.type === BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE)
      ).toBe(true);
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // No LOOP_COMPLETE since no terminal tool was called
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_COMPLETE)).toBe(
        false
      );
    });
  });

  describe('loop with maxTokens limit', () => {
    it('should stop loop when maxTokens exceeded', async () => {
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

      const testBrain = brain('test-max-tokens').loop('Long Task', () => ({
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
      expect(events.some((e) => e.type === BRAIN_EVENTS.LOOP_TOKEN_LIMIT)).toBe(
        true
      );

      const tokenLimitEvent = events.find(
        (e) => e.type === BRAIN_EVENTS.LOOP_TOKEN_LIMIT
      ) as LoopTokenLimitEvent;
      expect(tokenLimitEvent.totalTokens).toBeGreaterThanOrEqual(1000);

      // Loop should still complete
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    });
  });

  describe('loop with waitFor', () => {
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

      const testBrain = brain('test-waitfor').loop('Handle Escalation', () => ({
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
  });

  describe('loop throws when generateText not implemented', () => {
    it('should throw descriptive error when client lacks generateText', async () => {
      const clientWithoutGenerateText: ObjectGenerator = {
        generateObject: mockGenerateObject,
        // No generateText
      };

      const testBrain = brain('test-no-generate-text').loop(
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

  describe('loop with system prompt', () => {
    it('should pass system prompt to generateText', async () => {
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

      const testBrain = brain('test-system').loop('With System', () => ({
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

      // Verify system was passed to generateText
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant.',
        })
      );
    });
  });

  describe('loop with state access', () => {
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
        .loop('Respond', ({ state }) => ({
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

      // Verify final state has both init step and loop result
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

      const testBrain = brain('test-event-order').loop('Task', () => ({
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

      // Verify order (includes STEP_STATUS for 'running' before loop)
      expect(eventTypes).toEqual([
        BRAIN_EVENTS.START,
        BRAIN_EVENTS.STEP_STATUS, // pending -> running
        BRAIN_EVENTS.STEP_START,
        BRAIN_EVENTS.STEP_STATUS, // running status during step
        BRAIN_EVENTS.LOOP_START,
        BRAIN_EVENTS.LOOP_ITERATION,
        BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE,
        BRAIN_EVENTS.LOOP_TOOL_CALL,
        BRAIN_EVENTS.LOOP_COMPLETE,
        BRAIN_EVENTS.STEP_COMPLETE,
        BRAIN_EVENTS.STEP_STATUS, // running -> complete
        BRAIN_EVENTS.COMPLETE,
      ]);
    });
  });
});
