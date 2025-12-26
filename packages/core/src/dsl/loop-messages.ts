import { BRAIN_EVENTS } from './constants.js';
import type {
  BrainEvent,
  LoopStartEvent,
  LoopAssistantMessageEvent,
  LoopToolResultEvent,
  LoopWebhookEvent,
} from './brain.js';
import type { ToolMessage } from '../clients/types.js';
import type { JsonObject } from './types.js';

export interface LoopResumeContext {
  messages: ToolMessage[];
  pendingToolCallId: string;
  pendingToolName: string;
  prompt: string;
  system?: string;
}

/**
 * Reconstructs the loop context from stored events and a webhook response.
 * Returns null if this is not a loop resume (no LOOP_WEBHOOK event found).
 */
export function reconstructLoopContext(
  events: BrainEvent[],
  webhookResponse: JsonObject
): LoopResumeContext | null {
  // Find LOOP_WEBHOOK event - if not present, this is not a loop resume
  const loopWebhookEvent = events.find(
    (e): e is LoopWebhookEvent => e.type === BRAIN_EVENTS.LOOP_WEBHOOK
  );
  if (!loopWebhookEvent) {
    return null;
  }

  // Find LOOP_START to get the initial prompt and system
  const loopStartEvent = events.find(
    (e): e is LoopStartEvent => e.type === BRAIN_EVENTS.LOOP_START
  );
  if (!loopStartEvent) {
    throw new Error(
      'LOOP_START event not found but LOOP_WEBHOOK exists - invalid event sequence'
    );
  }

  const messages: ToolMessage[] = [];

  // Add initial user message from the prompt
  messages.push({ role: 'user', content: loopStartEvent.prompt });

  // Process events in order to rebuild conversation
  for (const event of events) {
    if (event.type === BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE) {
      const assistantEvent = event as LoopAssistantMessageEvent;
      messages.push({
        role: 'assistant',
        content: assistantEvent.content,
      });
    } else if (event.type === BRAIN_EVENTS.LOOP_TOOL_RESULT) {
      const toolResultEvent = event as LoopToolResultEvent;
      messages.push({
        role: 'tool',
        content: JSON.stringify(toolResultEvent.result),
        toolCallId: toolResultEvent.toolCallId,
        toolName: toolResultEvent.toolName,
      });
    }
  }

  // Add the webhook response as the pending tool's result
  messages.push({
    role: 'tool',
    content: JSON.stringify(webhookResponse),
    toolCallId: loopWebhookEvent.toolCallId,
    toolName: loopWebhookEvent.toolName,
  });

  return {
    messages,
    pendingToolCallId: loopWebhookEvent.toolCallId,
    pendingToolName: loopWebhookEvent.toolName,
    prompt: loopStartEvent.prompt,
    system: loopStartEvent.system,
  };
}
