import { BRAIN_EVENTS } from './constants.js';
import type {
  BrainEvent,
  AgentStartEvent,
  AgentAssistantMessageEvent,
  AgentToolResultEvent,
  AgentWebhookEvent,
} from './definitions/events.js';
import type { ToolMessage } from '../clients/types.js';
import type { JsonObject } from './types.js';

export interface AgentResumeContext {
  messages: ToolMessage[];
  pendingToolCallId: string;
  pendingToolName: string;
  prompt: string;
  system?: string;
  /** The raw webhook response for event emission */
  webhookResponse: JsonObject;
}

/**
 * Reconstructs the agent context from stored events and a webhook response.
 * Returns null if this is not an agent resume (no AGENT_WEBHOOK event found).
 */
export function reconstructAgentContext(
  events: BrainEvent[],
  webhookResponse: JsonObject
): AgentResumeContext | null {
  // Find AGENT_WEBHOOK event - if not present, this is not an agent resume
  const agentWebhookEvent = events.find(
    (e): e is AgentWebhookEvent => e.type === BRAIN_EVENTS.AGENT_WEBHOOK
  );
  if (!agentWebhookEvent) {
    return null;
  }

  // Find AGENT_START to get the initial prompt and system
  const agentStartEvent = events.find(
    (e): e is AgentStartEvent => e.type === BRAIN_EVENTS.AGENT_START
  );
  if (!agentStartEvent) {
    throw new Error(
      'AGENT_START event not found but AGENT_WEBHOOK exists - invalid event sequence'
    );
  }

  const messages: ToolMessage[] = [];

  // Add initial user message from the prompt
  messages.push({ role: 'user', content: agentStartEvent.prompt });

  // Process events in order to rebuild conversation
  for (const event of events) {
    if (event.type === BRAIN_EVENTS.AGENT_ASSISTANT_MESSAGE) {
      const assistantEvent = event as AgentAssistantMessageEvent;
      messages.push({
        role: 'assistant',
        content: assistantEvent.content,
      });
    } else if (event.type === BRAIN_EVENTS.AGENT_TOOL_RESULT) {
      const toolResultEvent = event as AgentToolResultEvent;
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
    toolCallId: agentWebhookEvent.toolCallId,
    toolName: agentWebhookEvent.toolName,
  });

  return {
    messages,
    pendingToolCallId: agentWebhookEvent.toolCallId,
    pendingToolName: agentWebhookEvent.toolName,
    prompt: agentStartEvent.prompt,
    system: agentStartEvent.system,
    webhookResponse,
  };
}
