import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import { brain, type BrainEvent } from '../src/dsl/brain.js';
import { z } from 'zod';
import { jest } from '@jest/globals';
import {
  runWithStateMachine,
  mockGenerateObject,
  mockGenerateText,
  mockCreateToolResultMessage,
  mockClient,
} from './brain-test-helpers.js';
import type { Tool, SignalProvider } from '../src/dsl/types.js';

// Helper: make a generateText response with a tool call
function toolCallResponse(
  toolName: string,
  args: unknown,
  toolCallId = 'call-1'
) {
  return {
    toolCalls: [{ toolCallId, toolName, args }],
    usage: { totalTokens: 100 },
    responseMessages: [`msg-${toolCallId}`],
  };
}

const searchTool: Tool = {
  description: 'Search',
  inputSchema: z.object({ q: z.string() }),
  execute: async () => ({ results: [] }),
};

describe('.prompt() with loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateToolResultMessage.mockImplementation(
      (toolCallId, toolName, result) => ({
        role: 'tool',
        toolCallId,
        toolName,
        content: JSON.stringify(result),
      })
    );
  });

  it('single-shot prompt (no loop) still works via PromptBlock', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { bio: 'Test bio' },
    });

    const testBrain = brain('test').prompt('Generate', () => ({
      message: 'Generate a bio',
      outputSchema: z.object({ bio: z.string() }),
    }));

    const { finalState } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.bio).toBe('Test bio');
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('basic loop: tools called, done tool ends loop, state merged', async () => {
    const searchWithResults: Tool = {
      description: 'Search',
      inputSchema: z.object({ q: z.string() }),
      execute: async ({ q }) => ({ results: [`result for ${q}`] }),
    };

    // Iteration 1: LLM calls search
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('search', { q: 'test query' })
    );
    // Iteration 2: LLM calls done
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { findings: 'Found stuff' }, 'call-2')
    );

    const testBrain = brain('test').prompt('Research', () => ({
      message: 'Research something',
      outputSchema: z.object({ findings: z.string() }),
      loop: { tools: { search: searchWithResults } },
    }));

    const { events, finalState } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.findings).toBe('Found stuff');
    expect(mockGenerateText).toHaveBeenCalledTimes(2);

    // Verify PROMPT_* events were emitted
    const promptEvents = events.filter((e) => e.type.startsWith('prompt:'));
    expect(promptEvents.some((e) => e.type === BRAIN_EVENTS.PROMPT_START)).toBe(
      true
    );
    expect(
      promptEvents.some((e) => e.type === BRAIN_EVENTS.PROMPT_TOOL_CALL)
    ).toBe(true);
    expect(
      promptEvents.some((e) => e.type === BRAIN_EVENTS.PROMPT_TOOL_RESULT)
    ).toBe(true);
    expect(
      promptEvents.some((e) => e.type === BRAIN_EVENTS.PROMPT_COMPLETE)
    ).toBe(true);

    // Verify PROMPT_COMPLETE has the right data
    const completeEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.PROMPT_COMPLETE
    );
    expect(completeEvent).toMatchObject({
      result: { findings: 'Found stuff' },
      terminalTool: 'done',
      totalIterations: 2,
    });
  });

  it('done tool validation: invalid output feeds error back, LLM retries', async () => {
    // Iteration 1: LLM calls done with wrong shape
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { wrong: 'field' })
    );
    // Iteration 2: LLM calls done with correct shape
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { result: 'correct' }, 'call-2')
    );

    const testBrain = brain('test').prompt('Gen', () => ({
      message: 'Do it',
      outputSchema: z.object({ result: z.string() }),
      loop: { tools: {} },
    }));

    const { finalState, events } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.result).toBe('correct');
    expect(mockGenerateText).toHaveBeenCalledTimes(2);

    // The first done call should have produced an error tool result
    const toolResults = events.filter(
      (e) => e.type === BRAIN_EVENTS.PROMPT_TOOL_RESULT
    );
    expect(toolResults[0].result).toMatch(/Invalid output/);
  });

  it.each([
    [
      'iteration',
      { maxIterations: 3 },
      /Iteration limit \(3\)/,
      BRAIN_EVENTS.PROMPT_ITERATION_LIMIT,
    ],
    [
      'token',
      { maxTokens: 150 },
      /Token limit \(150\)/,
      BRAIN_EVENTS.PROMPT_TOKEN_LIMIT,
    ],
  ] as const)(
    '%s limit exceeded',
    async (label, loopConfig, errorPattern, expectedEvent) => {
      mockGenerateText.mockResolvedValue(
        toolCallResponse('search', { q: 'test' })
      );

      const testBrain = brain('test').prompt('Loop', () => ({
        message: 'Loop forever',
        outputSchema: z.object({ result: z.string() }),
        loop: { tools: { search: searchTool }, ...loopConfig },
      }));

      const events: BrainEvent<any>[] = [];
      await expect(async () => {
        for await (const event of testBrain.run({
          client: mockClient,
          currentUser: { name: 'test-user' },
        })) {
          events.push(event);
        }
      }).rejects.toThrow(errorPattern);

      expect(events.some((e) => e.type === expectedEvent)).toBe(true);
    }
  );

  it('custom terminal tool ends the loop', async () => {
    const finishTool: Tool = {
      description: 'Finish',
      inputSchema: z.object({ answer: z.string() }),
      terminal: true,
    };

    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('finish', { answer: 'done!' })
    );

    const testBrain = brain('test').prompt('Work', () => ({
      message: 'Do work',
      outputSchema: z.object({ answer: z.string() }),
      loop: { tools: { finish: finishTool } },
    }));

    const { finalState, events } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.answer).toBe('done!');
    const completeEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.PROMPT_COMPLETE
    );
    expect(completeEvent).toMatchObject({
      terminalTool: 'finish',
    });
  });

  it('unknown tool throws', async () => {
    mockGenerateText.mockResolvedValueOnce(toolCallResponse('nonexistent', {}));

    const testBrain = brain('test').prompt('Work', () => ({
      message: 'Do work',
      outputSchema: z.object({ result: z.string() }),
      loop: { tools: {} },
    }));

    await expect(async () => {
      for await (const event of testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
      })) {
        // drain
      }
    }).rejects.toThrow(/Unknown tool "nonexistent"/);
  });

  it.each([
    ['KILL', BRAIN_EVENTS.CANCELLED],
    ['PAUSE', BRAIN_EVENTS.PAUSED],
  ] as const)(
    '%s signal mid-loop stops brain',
    async (signalType, expectedEvent) => {
      let callCount = 0;
      const signalProvider: SignalProvider = {
        getSignals: async (filter) => {
          if (filter === 'CONTROL') {
            callCount++;
            if (callCount >= 2) return [{ type: signalType }];
          }
          return [];
        },
      };

      mockGenerateText.mockResolvedValue(
        toolCallResponse('search', { q: 'test' })
      );

      const testBrain = brain('test').prompt('Loop', () => ({
        message: 'Loop',
        outputSchema: z.object({ result: z.string() }),
        loop: { tools: { search: searchTool } },
      }));

      const events: BrainEvent<any>[] = [];
      for await (const event of testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        signalProvider,
      })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === expectedEvent)).toBe(true);
    }
  );

  it('system prompt is passed to generateText', async () => {
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { result: 'ok' })
    );

    const testBrain = brain('test').prompt('Gen', () => ({
      system: 'You are a helpful assistant',
      message: 'Help me',
      outputSchema: z.object({ result: z.string() }),
      loop: { tools: {} },
    }));

    await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a helpful assistant',
      })
    );
  });

  it('tool execution receives StepContext', async () => {
    let receivedContext: any;
    const captureTool: Tool = {
      description: 'Capture',
      inputSchema: z.object({}),
      execute: async (input, context) => {
        receivedContext = context;
        return { captured: true };
      },
    };

    // Iteration 1: call capture tool
    mockGenerateText.mockResolvedValueOnce(toolCallResponse('capture', {}));
    // Iteration 2: call done
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { result: 'ok' }, 'call-2')
    );

    const fakeComponents = {
      MyComponent: { component: () => null, description: 'A test component' },
    };

    const testBrain = brain('test')
      .withComponents(fakeComponents)
      .prompt('Cap', () => ({
        message: 'Capture context',
        outputSchema: z.object({ result: z.string() }),
        loop: { tools: { capture: captureTool } },
      }));

    await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(receivedContext).toBeDefined();
    expect(receivedContext.client).toBeDefined();
    expect(receivedContext.brainRunId).toBeDefined();
    expect(receivedContext.currentUser).toEqual({ name: 'test-user' });
    expect(receivedContext.components).toBe(fakeComponents);
  });

  it('text and tool calls in same response', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Thinking...',
      toolCalls: [
        { toolCallId: 'c1', toolName: 'search', args: { q: 'test' } },
      ],
      usage: { totalTokens: 100 },
      responseMessages: ['msg1'],
    });
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { result: 'ok' }, 'c2')
    );

    const testBrain = brain('test').prompt('Work', () => ({
      message: 'Work',
      outputSchema: z.object({ result: z.string() }),
      loop: { tools: { search: searchTool } },
    }));

    const { events } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(
      events.some((e) => e.type === BRAIN_EVENTS.PROMPT_ASSISTANT_MESSAGE)
    ).toBe(true);
    const msgEvent = events.find(
      (e) => e.type === BRAIN_EVENTS.PROMPT_ASSISTANT_MESSAGE
    );
    expect(msgEvent).toMatchObject({ text: 'Thinking...' });
  });

  it('multiple tool calls in one iteration', async () => {
    const toolA: Tool = {
      description: 'Tool A',
      inputSchema: z.object({ x: z.number() }),
      execute: async ({ x }) => ({ doubled: x * 2 }),
    };
    const toolB: Tool = {
      description: 'Tool B',
      inputSchema: z.object({ y: z.number() }),
      execute: async ({ y }) => ({ tripled: y * 3 }),
    };

    // Iteration 1: LLM calls both tools
    mockGenerateText.mockResolvedValueOnce({
      toolCalls: [
        { toolCallId: 'c1', toolName: 'toolA', args: { x: 5 } },
        { toolCallId: 'c2', toolName: 'toolB', args: { y: 3 } },
      ],
      usage: { totalTokens: 100 },
      responseMessages: ['msg1'],
    });
    // Iteration 2: done
    mockGenerateText.mockResolvedValueOnce(
      toolCallResponse('done', { result: 'computed' }, 'c3')
    );

    const testBrain = brain('test').prompt('Multi', () => ({
      message: 'Use tools',
      outputSchema: z.object({ result: z.string() }),
      loop: { tools: { toolA, toolB } },
    }));

    const { events, finalState } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.result).toBe('computed');

    // Should have 2 tool call events and 2 tool result events from iteration 1
    const toolCalls = events.filter(
      (e) => e.type === BRAIN_EVENTS.PROMPT_TOOL_CALL
    );
    expect(toolCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('.map() with prompt + loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateToolResultMessage.mockImplementation(
      (toolCallId, toolName, result) => ({
        role: 'tool',
        toolCallId,
        toolName,
        content: JSON.stringify(result),
      })
    );
  });

  it('runs prompt loop per item', async () => {
    // For each item, LLM calls done immediately
    mockGenerateText
      .mockResolvedValueOnce(
        toolCallResponse('done', { summary: 'Summary of A' })
      )
      .mockResolvedValueOnce(
        toolCallResponse('done', { summary: 'Summary of B' }, 'c2')
      );

    const testBrain = brain('test')
      .step('Init', () => ({ items: ['A', 'B'] }))
      .map('Summarize', 'summaries' as const, ({ state }) => ({
        prompt: {
          message: (item: string) => `Summarize: ${item}`,
          outputSchema: z.object({ summary: z.string() }),
          loop: { tools: {} },
        },
        over: state.items,
      }));

    const { finalState } = await runWithStateMachine(testBrain, {
      client: mockClient,
      currentUser: { name: 'test-user' },
    });

    expect(finalState.summaries).toHaveLength(2);
    expect(finalState.summaries[0]).toEqual(['A', { summary: 'Summary of A' }]);
    expect(finalState.summaries[1]).toEqual(['B', { summary: 'Summary of B' }]);
  });
});
