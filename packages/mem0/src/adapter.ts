import type {
  Adapter,
  BrainEvent,
  MemoryProvider,
  MemoryMessage,
} from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';

/**
 * Configuration for the Mem0 adapter.
 */
export interface Mem0AdapterConfig {
  /** The memory provider to use for storing conversations */
  provider: MemoryProvider;
  /**
   * Optional function to extract a user ID from the brain options.
   * If not provided, memories are stored only with agentId scope.
   */
  getUserId?: (options: Record<string, unknown>) => string | undefined;
  /**
   * Whether to include tool calls in the conversation history.
   * Defaults to false.
   */
  includeToolCalls?: boolean;
}

/**
 * Message buffer for tracking conversation history per brain run.
 */
interface ConversationBuffer {
  agentId: string;
  userId?: string;
  messages: MemoryMessage[];
}

/**
 * Creates a Mem0 adapter that automatically indexes conversations to memory.
 *
 * The adapter listens to brain events and buffers messages from agent steps.
 * When the brain completes or encounters an error, it flushes the buffered
 * messages to the memory provider.
 *
 * @param config - Configuration for the adapter
 * @returns An Adapter implementation
 *
 * @example
 * ```typescript
 * import { createMem0Adapter, createMem0Provider } from '@positronic/mem0';
 * import { BrainRunner } from '@positronic/core';
 *
 * const provider = createMem0Provider({ apiKey: process.env.MEM0_API_KEY! });
 *
 * const adapter = createMem0Adapter({
 *   provider,
 *   getUserId: (options) => options.userId as string,
 * });
 *
 * const runner = new BrainRunner(myBrain)
 *   .withAdapters([adapter])
 *   .withClient(client);
 *
 * await runner.run({ userId: 'user-123' });
 * ```
 */
export function createMem0Adapter(config: Mem0AdapterConfig): Adapter {
  const { provider, getUserId, includeToolCalls = false } = config;

  // Buffer messages per brainRunId
  const buffers = new Map<string, ConversationBuffer>();

  return {
    async dispatch(event: BrainEvent): Promise<void> {
      const brainRunId = event.brainRunId;

      // Handle AGENT_START - initialize buffer for this run
      if (event.type === BRAIN_EVENTS.AGENT_START) {
        const agentId = event.stepTitle; // Use step title as agentId
        const userId = getUserId?.(event.options as Record<string, unknown>);

        // Initialize buffer if not exists
        if (!buffers.has(brainRunId)) {
          buffers.set(brainRunId, {
            agentId,
            userId,
            messages: [],
          });
        }

        // Add the initial user prompt as a message
        const buffer = buffers.get(brainRunId)!;
        buffer.messages.push({
          role: 'user',
          content: event.prompt,
        });
      }

      // Handle AGENT_USER_MESSAGE - add user message to buffer
      if (event.type === BRAIN_EVENTS.AGENT_USER_MESSAGE) {
        const buffer = buffers.get(brainRunId);
        if (buffer) {
          buffer.messages.push({
            role: 'user',
            content: event.content,
          });
        }
      }

      // Handle AGENT_ASSISTANT_MESSAGE - add assistant message to buffer
      if (event.type === BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE) {
        const buffer = buffers.get(brainRunId);
        if (buffer) {
          buffer.messages.push({
            role: 'assistant',
            content: event.content,
          });
        }
      }

      // Handle tool calls if configured
      if (includeToolCalls && event.type === BRAIN_EVENTS.AGENT_TOOL_CALL) {
        const buffer = buffers.get(brainRunId);
        if (buffer) {
          buffer.messages.push({
            role: 'assistant',
            content: `[Tool Call: ${event.toolName}] ${JSON.stringify(event.input)}`,
          });
        }
      }

      if (includeToolCalls && event.type === BRAIN_EVENTS.AGENT_TOOL_RESULT) {
        const buffer = buffers.get(brainRunId);
        if (buffer) {
          buffer.messages.push({
            role: 'assistant',
            content: `[Tool Result: ${event.toolName}] ${JSON.stringify(event.result)}`,
          });
        }
      }

      // Handle AGENT_COMPLETE - flush buffer on agent completion
      if (event.type === BRAIN_EVENTS.AGENT_COMPLETE) {
        await flushBuffer(brainRunId);
      }

      // Handle COMPLETE - flush buffer on brain completion
      if (event.type === BRAIN_EVENTS.COMPLETE) {
        await flushBuffer(brainRunId);
      }

      // Handle ERROR - clean up buffer without flushing
      if (event.type === BRAIN_EVENTS.ERROR) {
        buffers.delete(brainRunId);
      }

      // Handle CANCELLED - clean up buffer without flushing
      if (event.type === BRAIN_EVENTS.CANCELLED) {
        buffers.delete(brainRunId);
      }
    },
  };

  async function flushBuffer(brainRunId: string): Promise<void> {
    const buffer = buffers.get(brainRunId);
    if (!buffer || buffer.messages.length === 0) {
      buffers.delete(brainRunId);
      return;
    }

    try {
      await provider.add(buffer.messages, {
        agentId: buffer.agentId,
        userId: buffer.userId,
      });
    } finally {
      buffers.delete(brainRunId);
    }
  }
}
