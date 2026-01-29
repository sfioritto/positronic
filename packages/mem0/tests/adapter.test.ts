import { jest } from '@jest/globals';
import { createMem0Adapter } from '../src/adapter.js';
import type { MemoryProvider, BrainEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';

const createMockProvider = (): jest.Mocked<MemoryProvider> => ({
  search: jest.fn<MemoryProvider['search']>().mockResolvedValue([]),
  add: jest.fn<MemoryProvider['add']>().mockResolvedValue(undefined),
});

describe('createMem0Adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should buffer messages during agent execution', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    // Simulate agent start
    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Hello, how are you?',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    // Simulate assistant message
    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      content: "I'm doing well, thanks!",
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    // Simulate brain complete - should flush buffer
    await adapter.dispatch({
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'complete',
    } as BrainEvent);

    expect(mockProvider.add).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: "I'm doing well, thanks!" },
      ],
      { agentId: 'my-agent', userId: undefined }
    );
  });

  it('should extract userId using getUserId function', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({
      provider: mockProvider,
      getUserId: (options) => options.userId as string,
    });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Hello',
      brainRunId: 'run-1',
      options: { userId: 'user-123' },
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: { userId: 'user-123' },
      status: 'complete',
    } as BrainEvent);

    expect(mockProvider.add).toHaveBeenCalledWith(
      expect.any(Array),
      { agentId: 'my-agent', userId: 'user-123' }
    );
  });

  it('should include user messages injected during execution', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Initial prompt',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_USER_MESSAGE,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      content: 'User follow-up message',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'complete',
    } as BrainEvent);

    expect(mockProvider.add).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Initial prompt' },
        { role: 'user', content: 'User follow-up message' },
      ],
      expect.any(Object)
    );
  });

  it('should include tool calls when includeToolCalls is true', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({
      provider: mockProvider,
      includeToolCalls: true,
    });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Help me',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_TOOL_CALL,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      toolName: 'search',
      toolCallId: 'call-1',
      input: { query: 'typescript' },
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_TOOL_RESULT,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      toolName: 'search',
      toolCallId: 'call-1',
      result: { found: 5 },
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'complete',
    } as BrainEvent);

    expect(mockProvider.add).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Help me' },
        { role: 'assistant', content: '[Tool Call: search] {"query":"typescript"}' },
        { role: 'assistant', content: '[Tool Result: search] {"found":5}' },
      ],
      expect.any(Object)
    );
  });

  it('should not include tool calls by default', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Help me',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_TOOL_CALL,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      toolName: 'search',
      toolCallId: 'call-1',
      input: { query: 'typescript' },
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'complete',
    } as BrainEvent);

    expect(mockProvider.add).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Help me' }],
      expect.any(Object)
    );
  });

  it('should clean up buffer on error without flushing', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Hello',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.ERROR,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'error',
      error: { name: 'Error', message: 'Something went wrong' },
    } as BrainEvent);

    expect(mockProvider.add).not.toHaveBeenCalled();
  });

  it('should clean up buffer on cancelled without flushing', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Hello',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.CANCELLED,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'cancelled',
    } as BrainEvent);

    expect(mockProvider.add).not.toHaveBeenCalled();
  });

  it('should flush buffer on agent complete', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_START,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      prompt: 'Hello',
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    await adapter.dispatch({
      type: BRAIN_EVENTS.AGENT_COMPLETE,
      stepTitle: 'my-agent',
      stepId: 'step-1',
      terminalToolName: 'done',
      result: {},
      totalIterations: 1,
      totalTokens: 100,
      brainRunId: 'run-1',
      options: {},
    } as BrainEvent);

    expect(mockProvider.add).toHaveBeenCalled();
  });

  it('should not call add when buffer is empty', async () => {
    const mockProvider = createMockProvider();
    const adapter = createMem0Adapter({ provider: mockProvider });

    // Just dispatch complete without any messages
    await adapter.dispatch({
      type: BRAIN_EVENTS.COMPLETE,
      brainTitle: 'test-brain',
      brainRunId: 'run-1',
      options: {},
      status: 'complete',
    } as BrainEvent);

    expect(mockProvider.add).not.toHaveBeenCalled();
  });
});
