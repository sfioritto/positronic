import { BRAIN_EVENTS } from './constants.js';
import type {
  BrainEvent,
  AgentStartEvent,
  AgentWebhookEvent,
} from './definitions/events.js';
import type { ResponseMessage } from '../clients/types.js';
import type { JsonObject } from './types.js';

export interface AgentResumeContext {
  /** SDK-native messages preserving provider metadata (e.g., Gemini's thoughtSignature) */
  responseMessages: ResponseMessage[];
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

  // Use the responseMessages from the AGENT_WEBHOOK event directly
  // These preserve SDK-specific metadata (like Gemini's thoughtSignature)
  return {
    responseMessages: agentWebhookEvent.responseMessages,
    pendingToolCallId: agentWebhookEvent.toolCallId,
    pendingToolName: agentWebhookEvent.toolName,
    prompt: agentStartEvent.prompt,
    system: agentStartEvent.system,
    webhookResponse,
  };
}
