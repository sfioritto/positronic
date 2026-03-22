import type {
  Adapter,
  BrainEvent,
  BrainStartEvent,
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
 * const adapter = createMem0Adapter({ provider });
 *
 * const runner = new BrainRunner({
 *   adapters: [adapter],
 *   client,
 * });
 *
 * await runner.run(myBrain);
 * ```
 */
export function createMem0Adapter(config: Mem0AdapterConfig): Adapter {
  const { provider, includeToolCalls = false } = config;

  // Buffer messages per brainRunId
  const buffers = new Map<string, ConversationBuffer>();

  return {
    async dispatch(event: BrainEvent): Promise<void> {
      const brainRunId = event.brainRunId;

      // Handle START - capture currentUser for later use in scope
      if (event.type === BRAIN_EVENTS.START) {
        const startEvent = event as BrainStartEvent;
        const existing = buffers.get(brainRunId);
        if (existing) {
          existing.agentId = startEvent.brainTitle;
          existing.userId = startEvent.currentUser.name;
        } else {
          buffers.set(brainRunId, {
            agentId: startEvent.brainTitle,
            userId: startEvent.currentUser.name,
            messages: [],
          });
        }
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
