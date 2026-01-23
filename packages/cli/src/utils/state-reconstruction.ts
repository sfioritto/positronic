import type { BrainEvent, BrainStartEvent, StepCompletedEvent } from '@positronic/core';
import { applyPatches, BRAIN_EVENTS } from '@positronic/core';

type JsonObject = { [key: string]: unknown };

export interface StoredEvent {
  timestamp: Date;
  event: BrainEvent;
}

/**
 * Reconstructs the brain state at a specific event index by:
 * 1. Finding the most recent brain:start or brain:restart event at or before the target index
 * 2. Extracting the initialState from that event
 * 3. Applying all step:complete patches from that point up to and including the target index
 *
 * @param events - Array of stored events
 * @param targetIndex - The event index to reconstruct state at
 * @returns The reconstructed state at that point in time
 */
export function reconstructStateAtEvent(
  events: StoredEvent[],
  targetIndex: number
): JsonObject {
  if (events.length === 0 || targetIndex < 0) {
    return {};
  }

  // Clamp targetIndex to valid range
  const effectiveIndex = Math.min(targetIndex, events.length - 1);

  // Find the most recent brain:start or brain:restart at or before targetIndex
  let startIndex = -1;
  let initialState: JsonObject = {};

  for (let i = effectiveIndex; i >= 0; i--) {
    const event = events[i].event;
    if (event.type === BRAIN_EVENTS.START || event.type === BRAIN_EVENTS.RESTART) {
      startIndex = i;
      const startEvent = event as BrainStartEvent;
      initialState = (startEvent.initialState as JsonObject) ?? {};
      break;
    }
  }

  // If no start event found, return empty state
  if (startIndex === -1) {
    return {};
  }

  // Apply all step:complete patches from start to targetIndex
  let currentState = { ...initialState };

  for (let i = startIndex; i <= effectiveIndex; i++) {
    const event = events[i].event;
    if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
      const stepCompleteEvent = event as StepCompletedEvent;
      if (stepCompleteEvent.patch && stepCompleteEvent.patch.length > 0) {
        currentState = applyPatches(currentState, stepCompleteEvent.patch) as JsonObject;
      }
    }
  }

  return currentState;
}
