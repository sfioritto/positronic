import { BRAIN_EVENTS } from '@positronic/core';
import type {
  AgentStartEvent,
  AgentRawResponseMessageEvent,
} from '@positronic/core';
import type { StoredEvent } from './state-reconstruction.js';

export interface AgentLoopInfo {
  stepId: string;
  stepTitle: string;
  label: string; // stepTitle, or brainTitle if stepTitle is 'main'
  startEvent: AgentStartEvent;
  rawResponseEvents: AgentRawResponseMessageEvent[];
}

/**
 * Get display label for an agent.
 * If stepTitle is 'main' (brain-level agent), use brainTitle instead.
 */
export function getAgentLabel(stepTitle: string, brainTitle?: string): string {
  if (stepTitle === 'main' && brainTitle) {
    return brainTitle;
  }
  return stepTitle;
}

/**
 * Extract all unique agent loops from events.
 * Groups by stepId to handle multiple agents.
 */
export function getAgentLoops(
  events: StoredEvent[],
  brainTitle?: string
): AgentLoopInfo[] {
  const agentMap = new Map<
    string,
    {
      startEvent: AgentStartEvent;
      rawResponseEvents: AgentRawResponseMessageEvent[];
    }
  >();

  for (const { event } of events) {
    if (event.type === BRAIN_EVENTS.AGENT_START) {
      const agentStart = event as AgentStartEvent;
      const existing = agentMap.get(agentStart.stepId);
      if (!existing) {
        agentMap.set(agentStart.stepId, {
          startEvent: agentStart,
          rawResponseEvents: [],
        });
      }
    } else if (event.type === BRAIN_EVENTS.AGENT_RAW_RESPONSE_MESSAGE) {
      const rawResponse = event as AgentRawResponseMessageEvent;
      const existing = agentMap.get(rawResponse.stepId);
      if (existing) {
        existing.rawResponseEvents.push(rawResponse);
      }
    }
  }

  return Array.from(agentMap.entries()).map(
    ([stepId, { startEvent, rawResponseEvents }]) => ({
      stepId,
      stepTitle: startEvent.stepTitle,
      label: getAgentLabel(startEvent.stepTitle, brainTitle),
      startEvent,
      rawResponseEvents,
    })
  );
}
