/**
 * Keyboard handler for the Watch component.
 * Maps keyboard input to watch events that the state machine can process.
 *
 * This is a pure function that takes the current view state and keyboard input,
 * and returns an event object (or null if no event should be triggered).
 */

import type { Key } from 'ink';
import type { EventsViewMode } from './events-view.js';

// View modes that the watch component can be in
export type ViewMode =
  | 'progress'
  | 'events'
  | 'state'
  | 'agent-picker'
  | 'agent-chat'
  | 'message-input';

// Events that can be triggered by keyboard input
export type WatchKeyboardEvent =
  // View navigation
  | { type: 'GO_TO_EVENTS' }
  | { type: 'GO_TO_PROGRESS' }
  | { type: 'GO_TO_STATE' }
  | { type: 'GO_TO_AGENTS' }
  | { type: 'GO_TO_MESSAGE_INPUT' }
  | { type: 'GO_BACK' }
  // Kill flow
  | { type: 'INITIATE_KILL' }
  | { type: 'CONFIRM_KILL' }
  | { type: 'CANCEL_KILL' }
  // Pause/Resume
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  // Quit
  | { type: 'QUIT' }
  // Message input mode (escape cancels)
  | { type: 'CANCEL_MESSAGE_INPUT' };

// Context needed to determine which keyboard events are valid
export interface WatchKeyboardContext {
  viewMode: ViewMode;
  eventsViewMode: EventsViewMode;
  confirmingKill: boolean;
  isKilling: boolean;
  isKilled: boolean;
  isComplete: boolean;
  isPaused: boolean;
  isPausing: boolean;
  isResuming: boolean;
  hasAgents: boolean;
  manageScreenBuffer: boolean;
}

/**
 * Handle keyboard input and return the appropriate event.
 * Returns null if no event should be triggered.
 */
export function handleKeyboardInput(
  input: string,
  key: Key,
  ctx: WatchKeyboardContext
): WatchKeyboardEvent | null {
  const {
    viewMode,
    eventsViewMode,
    confirmingKill,
    isKilling,
    isKilled,
    isComplete,
    isPaused,
    isPausing,
    isResuming,
    hasAgents,
    manageScreenBuffer,
  } = ctx;

  // Kill confirmation mode takes priority
  if (confirmingKill) {
    if (input === 'y') {
      return { type: 'CONFIRM_KILL' };
    } else if (input === 'n' || key.escape) {
      return { type: 'CANCEL_KILL' };
    }
    // Block all other input during kill confirmation
    return null;
  }

  // View-specific handling
  switch (viewMode) {
    case 'state':
      // State view: 'b' goes back to previous view
      // j/k scrolling is handled by StateView component
      if (input === 'b') {
        return { type: 'GO_BACK' };
      }
      return null;

    case 'agent-chat':
      // Agent chat view: 'b' or escape goes back to previous view
      // j/k scrolling is handled by AgentChatView component
      if (input === 'b' || key.escape) {
        return { type: 'GO_BACK' };
      }
      return null;

    case 'agent-picker':
      // Agent picker: 'b' or escape goes back to previous view
      // SelectList handles its own navigation (up/down/enter)
      if (input === 'b' || key.escape) {
        return { type: 'GO_BACK' };
      }
      return null;

    case 'message-input':
      // Message input mode: Escape cancels
      // TextInput handles its own input and Enter (onSubmit)
      if (key.escape) {
        return { type: 'CANCEL_MESSAGE_INPUT' };
      }
      return null;

    case 'events':
    case 'progress':
    default:
      // Progress and events views share most keyboard handling
      return handleProgressAndEventsKeys(input, key, ctx);
  }
}

/**
 * Handle keyboard input when in progress or events view mode.
 */
function handleProgressAndEventsKeys(
  input: string,
  key: Key,
  ctx: WatchKeyboardContext
): WatchKeyboardEvent | null {
  const {
    viewMode,
    eventsViewMode,
    isKilling,
    isKilled,
    isComplete,
    isPaused,
    isPausing,
    isResuming,
    hasAgents,
    manageScreenBuffer,
  } = ctx;

  // View toggle
  if (input === 'e') {
    return { type: 'GO_TO_EVENTS' };
  }

  if (input === 'w') {
    return { type: 'GO_TO_PROGRESS' };
  }

  // 'b' in events list mode goes back to progress view
  // 'b' in events detail mode is handled by EventsView to go back to list
  if (input === 'b' && viewMode === 'events' && eventsViewMode !== 'detail') {
    return { type: 'GO_TO_PROGRESS' };
  }

  // 's' from progress view: show current state
  if (input === 's' && viewMode === 'progress') {
    return { type: 'GO_TO_STATE' };
  }

  // 'x' initiates kill (only when brain is running)
  if (input === 'x' && !isKilling && !isKilled && !isComplete) {
    return { type: 'INITIATE_KILL' };
  }

  // 'a' or 'A' shows agent view (if agents exist)
  if ((input === 'a' || input === 'A') && hasAgents) {
    return { type: 'GO_TO_AGENTS' };
  }

  // 'm' enters message input mode (only when brain is running and has agents)
  if (input === 'm' && !isComplete && hasAgents) {
    return { type: 'GO_TO_MESSAGE_INPUT' };
  }

  // 'p' pauses the brain (only when running and not already paused/pausing)
  if (input === 'p' && !isComplete && !isPaused && !isPausing) {
    return { type: 'PAUSE' };
  }

  // 'r' resumes the brain (only when paused and not already resuming)
  if (input === 'r' && isPaused && !isResuming) {
    return { type: 'RESUME' };
  }

  // 'q' or escape quits (only when standalone with manageScreenBuffer=true)
  if ((input === 'q' || key.escape) && manageScreenBuffer) {
    return { type: 'QUIT' };
  }

  return null;
}
