/**
 * State management for the Watch component.
 *
 * Uses useReducer for UI navigation and async operations.
 * Brain execution tracking (useBrainMachine) and EventSource connection
 * remain separate concerns.
 */

import { useReducer, useCallback, useRef, useEffect } from 'react';
import { apiClient } from '../commands/helpers.js';
import type { ViewMode } from './watch-keyboard.js';

type JsonObject = { [key: string]: unknown };

export type { ViewMode };

export type PreviousView = 'progress' | 'events';

// ============================================================================
// State
// ============================================================================

export interface WatchState {
  viewMode: ViewMode;
  previousView: PreviousView;
  stateSnapshot: JsonObject | null;
  stateTitle: string;
  stateScrollOffset: number;
  selectedAgentId: string | null;
  agentChatScrollOffset: number;
  eventsSelectedIndex: number | null;
  killStatus: 'idle' | 'confirming' | 'killing' | 'killed' | 'error';
  killError: Error | null;
  pauseResumeStatus: 'idle' | 'pausing' | 'resuming';
  pauseResumeMessage: string | null;
  messageText: string;
  messageStatus: 'idle' | 'sending';
  messageFeedback: 'success' | 'error' | null;
}

// ============================================================================
// Actions
// ============================================================================

export type WatchAction =
  // Navigation
  | { type: 'GO_TO_PROGRESS' }
  | { type: 'GO_TO_EVENTS' }
  | {
      type: 'GO_TO_STATE';
      stateSnapshot: JsonObject;
      stateTitle: string;
      fromView: PreviousView;
    }
  | { type: 'GO_TO_AGENTS'; selectedAgentId?: string; fromView: PreviousView }
  | { type: 'GO_TO_MESSAGE_INPUT'; fromView: PreviousView }
  | { type: 'GO_BACK' }
  // State view
  | { type: 'SET_STATE_SCROLL_OFFSET'; offset: number }
  // Agent view
  | { type: 'AGENT_SELECTED'; agentId: string }
  | { type: 'SET_AGENT_CHAT_SCROLL_OFFSET'; offset: number }
  // Events
  | { type: 'SET_EVENTS_SELECTED_INDEX'; index: number | null }
  // Kill flow
  | { type: 'INITIATE_KILL' }
  | { type: 'CONFIRM_KILL' }
  | { type: 'CANCEL_KILL' }
  | { type: 'KILL_STARTED' }
  | { type: 'KILL_SUCCESS' }
  | { type: 'KILL_ERROR'; error: Error }
  // Pause/Resume
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'PAUSE_STARTED' }
  | { type: 'PAUSE_SUCCESS' }
  | { type: 'PAUSE_ERROR' }
  | { type: 'RESUME_STARTED' }
  | { type: 'RESUME_SUCCESS' }
  | { type: 'RESUME_ERROR' }
  | { type: 'CLEAR_PAUSE_RESUME_MESSAGE' }
  // Message flow
  | { type: 'SET_MESSAGE_TEXT'; text: string }
  | { type: 'SEND_MESSAGE' }
  | { type: 'SEND_MESSAGE_STARTED' }
  | { type: 'MESSAGE_SUCCESS' }
  | { type: 'MESSAGE_ERROR' }
  | { type: 'CLEAR_FEEDBACK' }
  // Reset
  | { type: 'RESET'; viewMode: ViewMode };

// ============================================================================
// Reducer
// ============================================================================

function watchReducer(state: WatchState, action: WatchAction): WatchState {
  switch (action.type) {
    case 'GO_TO_PROGRESS':
      return { ...state, viewMode: 'progress' };

    case 'GO_TO_EVENTS':
      return { ...state, viewMode: 'events' };

    case 'GO_TO_STATE':
      return {
        ...state,
        viewMode: 'state',
        stateSnapshot: action.stateSnapshot,
        stateTitle: action.stateTitle,
        stateScrollOffset: 0,
        previousView: action.fromView,
      };

    case 'GO_TO_AGENTS':
      return {
        ...state,
        viewMode: action.selectedAgentId ? 'agent-chat' : 'agent-picker',
        selectedAgentId: action.selectedAgentId ?? null,
        agentChatScrollOffset: 0,
        previousView: action.fromView,
      };

    case 'GO_TO_MESSAGE_INPUT':
      return {
        ...state,
        viewMode: 'message-input',
        previousView: action.fromView,
      };

    case 'GO_BACK':
      switch (state.viewMode) {
        case 'state':
          return {
            ...state,
            viewMode: state.previousView,
            stateSnapshot: null,
          };
        case 'agent-chat':
          return {
            ...state,
            viewMode: state.previousView,
            selectedAgentId: null,
          };
        case 'message-input':
          return {
            ...state,
            viewMode: state.previousView,
            messageText: '',
            messageFeedback: null,
            messageStatus: 'idle',
          };
        default:
          return { ...state, viewMode: state.previousView };
      }

    case 'SET_STATE_SCROLL_OFFSET':
      return { ...state, stateScrollOffset: action.offset };

    case 'AGENT_SELECTED':
      return {
        ...state,
        viewMode: 'agent-chat',
        selectedAgentId: action.agentId,
        agentChatScrollOffset: 0,
      };

    case 'SET_AGENT_CHAT_SCROLL_OFFSET':
      return { ...state, agentChatScrollOffset: action.offset };

    case 'SET_EVENTS_SELECTED_INDEX':
      return { ...state, eventsSelectedIndex: action.index };

    // Kill flow
    case 'INITIATE_KILL':
      return { ...state, killStatus: 'confirming' };

    case 'CANCEL_KILL':
      return { ...state, killStatus: 'idle' };

    case 'KILL_STARTED':
      return { ...state, killStatus: 'killing', killError: null };

    case 'KILL_SUCCESS':
      return { ...state, killStatus: 'killed' };

    case 'KILL_ERROR':
      return { ...state, killStatus: 'error', killError: action.error };

    // Pause/Resume
    case 'PAUSE_STARTED':
      return { ...state, pauseResumeStatus: 'pausing' };

    case 'PAUSE_SUCCESS':
      return {
        ...state,
        pauseResumeStatus: 'idle',
        pauseResumeMessage: 'Pause signal sent',
      };

    case 'PAUSE_ERROR':
      return { ...state, pauseResumeStatus: 'idle' };

    case 'RESUME_STARTED':
      return { ...state, pauseResumeStatus: 'resuming' };

    case 'RESUME_SUCCESS':
      return {
        ...state,
        pauseResumeStatus: 'idle',
        pauseResumeMessage: 'Resume signal sent',
      };

    case 'RESUME_ERROR':
      return { ...state, pauseResumeStatus: 'idle' };

    case 'CLEAR_PAUSE_RESUME_MESSAGE':
      return { ...state, pauseResumeMessage: null };

    // Message flow
    case 'SET_MESSAGE_TEXT':
      return { ...state, messageText: action.text };

    case 'SEND_MESSAGE_STARTED':
      return { ...state, messageStatus: 'sending' };

    case 'MESSAGE_SUCCESS':
      return {
        ...state,
        messageText: '',
        messageFeedback: 'success',
        messageStatus: 'idle',
      };

    case 'MESSAGE_ERROR':
      return { ...state, messageFeedback: 'error', messageStatus: 'idle' };

    case 'CLEAR_FEEDBACK':
      if (state.messageFeedback === 'success') {
        return {
          ...state,
          viewMode: state.previousView,
          messageFeedback: null,
        };
      }
      return { ...state, messageFeedback: null };

    case 'RESET':
      return createInitialState(action.viewMode);

    default:
      return state;
  }
}

// ============================================================================
// Async operations
// ============================================================================

async function killBrain(runId: string) {
  const response = await apiClient.fetch(`/brains/runs/${runId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to kill brain: ${response.status}`);
  }
}

async function pauseBrain(runId: string) {
  const response = await apiClient.fetch(`/brains/runs/${runId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'PAUSE' }),
  });
  if (response.status !== 202) {
    throw new Error(`Failed to pause: ${response.status}`);
  }
}

async function resumeBrain(runId: string) {
  const response = await apiClient.fetch(`/brains/runs/${runId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'RESUME' }),
  });
  if (response.status !== 202) {
    throw new Error(`Failed to resume: ${response.status}`);
  }
}

async function sendUserMessage(runId: string, text: string) {
  const response = await apiClient.fetch(`/brains/runs/${runId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'USER_MESSAGE', content: text }),
  });
  if (response.status !== 202) {
    throw new Error(`Failed to send message: ${response.status}`);
  }
}

// ============================================================================
// React Hook
// ============================================================================

function createInitialState(viewMode: ViewMode): WatchState {
  return {
    viewMode,
    previousView: 'progress',
    stateSnapshot: null,
    stateTitle: '',
    stateScrollOffset: 0,
    selectedAgentId: null,
    agentChatScrollOffset: 0,
    eventsSelectedIndex: null,
    killStatus: 'idle',
    killError: null,
    pauseResumeStatus: 'idle',
    pauseResumeMessage: null,
    messageText: '',
    messageStatus: 'idle',
    messageFeedback: null,
  };
}

/**
 * React hook for the watch UI state.
 * Manages view navigation, async operations (kill/pause/resume/message),
 * and related UI state like scroll offsets and selections.
 */
export function useWatchReducer(runId: string, startWithEvents = false) {
  const initialViewMode: ViewMode = startWithEvents ? 'events' : 'progress';
  const [state, dispatch] = useReducer(
    watchReducer,
    initialViewMode,
    createInitialState
  );

  // Reset when runId changes
  const prevRunIdRef = useRef(runId);
  useEffect(() => {
    if (prevRunIdRef.current !== runId) {
      prevRunIdRef.current = runId;
      dispatch({ type: 'RESET', viewMode: initialViewMode });
    }
  }, [runId, initialViewMode]);

  // Ref for accessing latest state in async callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback(
    (action: WatchAction) => {
      switch (action.type) {
        case 'CONFIRM_KILL':
          dispatch({ type: 'KILL_STARTED' });
          killBrain(runId).then(
            () => dispatch({ type: 'KILL_SUCCESS' }),
            (error) => dispatch({ type: 'KILL_ERROR', error })
          );
          break;

        case 'PAUSE':
          dispatch({ type: 'PAUSE_STARTED' });
          pauseBrain(runId).then(
            () => dispatch({ type: 'PAUSE_SUCCESS' }),
            () => dispatch({ type: 'PAUSE_ERROR' })
          );
          break;

        case 'RESUME':
          dispatch({ type: 'RESUME_STARTED' });
          resumeBrain(runId).then(
            () => dispatch({ type: 'RESUME_SUCCESS' }),
            () => dispatch({ type: 'RESUME_ERROR' })
          );
          break;

        case 'SEND_MESSAGE': {
          const text = stateRef.current.messageText.trim();
          if (!text) return;
          dispatch({ type: 'SEND_MESSAGE_STARTED' });
          sendUserMessage(runId, text).then(
            () => dispatch({ type: 'MESSAGE_SUCCESS' }),
            () => dispatch({ type: 'MESSAGE_ERROR' })
          );
          break;
        }

        default:
          dispatch(action);
      }
    },
    [runId]
  );

  return [state, send] as const;
}
