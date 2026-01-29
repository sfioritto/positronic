import { jest } from '@jest/globals';
import {
  brain,
  BrainRunner,
  BRAIN_EVENTS,
  applyPatches,
  type BrainEvent,
  type ObjectGenerator,
  type AgentTool,
} from '@positronic/core';
import { z, type ZodType } from 'zod';
import { createMem0Adapter } from '../src/adapter.js';
import { createMem0Tools, rememberFact, recallMemories } from '../src/tools.js';
import {
  createMockProvider,
  collectEvents,
} from './test-helpers.js';

// Cast memory tools to be compatible with brain's tools type
// This is needed because AgentTool<T> has variance issues with specific Zod types
const memoryTools = {
  rememberFact: rememberFact as unknown as AgentTool<ZodType>,
  recallMemories: recallMemories as unknown as AgentTool<ZodType>,
};

// Mock ObjectGenerator with generateText support
const mockGenerateText = jest.fn<NonNullable<ObjectGenerator['generateText']>>();
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockStreamText = jest.fn<ObjectGenerator['streamText']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
  streamText: mockStreamText,
};

describe('Memory Tools Integration', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockGenerateObject.mockReset();
  });

  describe('rememberFact tool', () => {
    it('stores a fact via brain memory when called by agent', async () => {
      const provider = createMockProvider();

      // Mock LLM to call rememberFact tool then complete
      mockGenerateText
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'rememberFact',
              args: { fact: 'User prefers dark mode' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'done',
              args: { message: 'Done' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        });

      const testBrain = brain('test-remember')
        .withMemory(provider)
        .brain('Remember', () => ({
          prompt: 'Remember that the user prefers dark mode',
          tools: {
            ...memoryTools,
            done: {
              description: 'Complete the task',
              inputSchema: z.object({ message: z.string() }),
              terminal: true,
            },
          },
        }));

      const events = await collectEvents(testBrain.run({ client: mockClient }));

      // Verify brain completed
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Verify the provider received the fact
      const addCalls = provider.getAddCalls();
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0].messages).toEqual([
        { role: 'assistant', content: 'User prefers dark mode' },
      ]);
      expect(addCalls[0].scope.agentId).toBe('test-remember');
    });

    it('passes userId to provider when specified', async () => {
      const provider = createMockProvider();

      mockGenerateText
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'rememberFact',
              args: { fact: 'User likes TypeScript', userId: 'user-123' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'done',
              args: {},
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        });

      const testBrain = brain('test-remember-user')
        .withMemory(provider)
        .brain('Remember User Pref', () => ({
          prompt: 'Store user preference',
          tools: {
            ...memoryTools,
            done: {
              description: 'Done',
              inputSchema: z.object({}),
              terminal: true,
            },
          },
        }));

      await collectEvents(testBrain.run({ client: mockClient }));

      const addCalls = provider.getAddCalls();
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0].scope.userId).toBe('user-123');
    });

    it('returns remembered: false when memory is not configured', async () => {
      mockGenerateText
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'rememberFact',
              args: { fact: 'Some fact' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'done',
              args: {},
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        });

      // Brain WITHOUT memory provider
      const testBrain = brain('test-no-memory').brain('Remember', () => ({
        prompt: 'Try to remember something',
        tools: {
          ...memoryTools,
          done: {
            description: 'Done',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
      }));

      const events = await collectEvents(testBrain.run({ client: mockClient }));

      // Should still complete successfully
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Find tool result event to verify response
      const toolResultEvent = events.find(
        (e) =>
          e.type === BRAIN_EVENTS.AGENT_TOOL_RESULT &&
          (e as any).toolName === 'rememberFact'
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.result).toEqual({
        remembered: false,
        fact: 'Some fact',
      });
    });
  });

  describe('recallMemories tool', () => {
    it('retrieves memories from provider when called by agent', async () => {
      const provider = createMockProvider();
      provider.seedMemories([
        { id: '1', content: 'User prefers dark mode', score: 0.95 },
        { id: '2', content: 'User likes TypeScript', score: 0.85 },
      ]);

      mockGenerateText
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'recallMemories',
              args: { query: 'user preferences', limit: 10 },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'done',
              args: { summary: 'User prefers dark mode and TypeScript' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        });

      const testBrain = brain('test-recall')
        .withMemory(provider)
        .brain('Recall Preferences', () => ({
          prompt: 'What are the user preferences?',
          tools: {
            ...memoryTools,
            done: {
              description: 'Summarize findings',
              inputSchema: z.object({ summary: z.string() }),
              terminal: true,
            },
          },
        }));

      const events = await collectEvents(testBrain.run({ client: mockClient }));

      // Verify brain completed
      expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);

      // Verify the search was called
      const searchCalls = provider.getSearchCalls();
      expect(searchCalls).toHaveLength(1);
      expect(searchCalls[0].query).toBe('user preferences');
      expect(searchCalls[0].scope.agentId).toBe('test-recall');

      // Verify tool result contains the memories
      const toolResultEvent = events.find(
        (e) =>
          e.type === BRAIN_EVENTS.AGENT_TOOL_RESULT &&
          (e as any).toolName === 'recallMemories'
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.result.found).toBe(2);
      expect(toolResultEvent.result.memories).toEqual([
        { content: 'User prefers dark mode', relevance: 0.95 },
        { content: 'User likes TypeScript', relevance: 0.85 },
      ]);
    });

    it('returns empty results when memory is not configured', async () => {
      mockGenerateText
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'recallMemories',
              args: { query: 'anything' },
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        })
        .mockResolvedValueOnce({
          text: undefined,
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'done',
              args: {},
            },
          ],
          usage: { totalTokens: 50 },
          responseMessages: [],
        });

      // Brain WITHOUT memory provider
      const testBrain = brain('test-no-memory-recall').brain('Recall', () => ({
        prompt: 'Try to recall memories',
        tools: {
          ...memoryTools,
          done: {
            description: 'Done',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
      }));

      const events = await collectEvents(testBrain.run({ client: mockClient }));

      // Find tool result event
      const toolResultEvent = events.find(
        (e) =>
          e.type === BRAIN_EVENTS.AGENT_TOOL_RESULT &&
          (e as any).toolName === 'recallMemories'
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.result).toEqual({
        found: 0,
        memories: [],
      });
    });
  });

  describe('createMem0Tools', () => {
    it('returns both tools', () => {
      const tools = createMem0Tools();

      expect(tools.rememberFact).toBe(rememberFact);
      expect(tools.recallMemories).toBe(recallMemories);
    });
  });
});

describe('Mem0 Adapter Integration', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockGenerateObject.mockReset();
  });

  it('indexes conversation after successful brain run', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({ provider });

    mockGenerateText.mockResolvedValueOnce({
      text: 'I will help you with that.',
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'done',
          args: { message: 'Task completed' },
        },
      ],
      usage: { totalTokens: 100 },
      responseMessages: [],
    });

    const testBrain = brain('test-adapter').brain('Help User', () => ({
      prompt: 'Hello, can you help me?',
      tools: {
        done: {
          description: 'Complete the task',
          inputSchema: z.object({ message: z.string() }),
          terminal: true,
        },
      },
    }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    await runner.run(testBrain);

    // Verify provider.add() was called with the conversation
    const addCalls = provider.getAddCalls();
    expect(addCalls.length).toBeGreaterThan(0);

    // The initial prompt should be captured
    const lastCall = addCalls[addCalls.length - 1];
    expect(lastCall.messages.some((m) => m.role === 'user')).toBe(true);
    expect(lastCall.scope.agentId).toBe('Help User');
  });

  it('does not index when brain errors', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({ provider });

    // Make the client throw an error
    mockGenerateText.mockRejectedValueOnce(new Error('API error'));

    const testBrain = brain('test-error').brain('Will Fail', () => ({
      prompt: 'This will fail',
      tools: {
        done: {
          description: 'Done',
          inputSchema: z.object({}),
          terminal: true,
        },
      },
    }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    // The brain will error
    await expect(runner.run(testBrain)).rejects.toThrow('API error');

    // Verify provider.add() was NOT called
    expect(provider.getAddCalls()).toHaveLength(0);
  });

  it('extracts userId from brain options when getUserId is provided', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({
      provider,
      getUserId: (options) => options.userId as string,
    });

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

    const testBrain = brain('test-userid')
      .withOptionsSchema(z.object({ userId: z.string() }))
      .brain('Handle Request', () => ({
        prompt: 'Help the user',
        tools: {
          done: {
            description: 'Done',
            inputSchema: z.object({}),
            terminal: true,
          },
        },
      }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    await runner.run(testBrain, { options: { userId: 'user-456' } });

    // Verify provider received the userId
    const addCalls = provider.getAddCalls();
    expect(addCalls.length).toBeGreaterThan(0);
    expect(addCalls[0].scope.userId).toBe('user-456');
  });

  it('includes tool calls when configured', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({
      provider,
      includeToolCalls: true,
    });

    mockGenerateText
      .mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { query: 'status' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      })
      .mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'done',
            args: {},
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

    const testBrain = brain('test-toolcalls').brain('Process', () => ({
      prompt: 'Help me',
      tools: {
        lookup: {
          description: 'Look something up',
          inputSchema: z.object({ query: z.string() }),
          execute: async () => ({ result: 'found' }),
        },
        done: {
          description: 'Done',
          inputSchema: z.object({}),
          terminal: true,
        },
      },
    }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    await runner.run(testBrain);

    // Verify tool calls are included in the indexed conversation
    const addCalls = provider.getAddCalls();
    expect(addCalls.length).toBeGreaterThan(0);

    const lastCall = addCalls[addCalls.length - 1];
    const toolCallMessage = lastCall.messages.find((m) =>
      m.content.includes('[Tool Call: lookup]')
    );
    expect(toolCallMessage).toBeDefined();
  });

  it('does not include tool calls by default', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({ provider });

    mockGenerateText
      .mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'lookup',
            args: { query: 'test' },
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      })
      .mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          {
            toolCallId: 'call-2',
            toolName: 'done',
            args: {},
          },
        ],
        usage: { totalTokens: 50 },
        responseMessages: [],
      });

    const testBrain = brain('test-no-toolcalls').brain('Process', () => ({
      prompt: 'Help me',
      tools: {
        lookup: {
          description: 'Look something up',
          inputSchema: z.object({ query: z.string() }),
          execute: async () => ({ result: 'found' }),
        },
        done: {
          description: 'Done',
          inputSchema: z.object({}),
          terminal: true,
        },
      },
    }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    await runner.run(testBrain);

    // Verify tool calls are NOT included
    const addCalls = provider.getAddCalls();
    expect(addCalls.length).toBeGreaterThan(0);

    const lastCall = addCalls[addCalls.length - 1];
    const toolCallMessage = lastCall.messages.find((m) =>
      m.content.includes('[Tool Call:')
    );
    expect(toolCallMessage).toBeUndefined();
  });

  it('does not call add when buffer is empty', async () => {
    const provider = createMockProvider();
    const adapter = createMem0Adapter({ provider });

    // Simple step brain that doesn't have agent steps
    const testBrain = brain('test-no-agent').step('Simple', () => ({
      done: true,
    }));

    const runner = new BrainRunner({
      adapters: [adapter],
      client: mockClient,
    });

    await runner.run(testBrain);

    // No agent messages were generated, so nothing should be indexed
    expect(provider.getAddCalls()).toHaveLength(0);
  });
});
