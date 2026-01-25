import { BRAIN_EVENTS, STATUS } from '../src/dsl/constants.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
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
});
