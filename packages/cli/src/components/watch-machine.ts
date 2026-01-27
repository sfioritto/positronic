/**
 * State machine for the Watch component.
 *
 * This machine handles UI navigation and async operations for the watch view.
 * The brain execution tracking (useBrainMachine) and EventSource connection
 * remain separate concerns.
 */

import { useMemo } from 'react';
import * as robot3 from 'robot3';
import { useMachine } from 'react-robot';
import { apiClient } from '../commands/helpers.js';
import type { ViewMode } from './watch-keyboard.js';

const { createMachine, state, transition, reduce, invoke, immediate, guard } = robot3;

// Types
type JsonObject = { [key: string]: unknown };

// Re-export ViewMode for convenience
export type { ViewMode };

export type PreviousView = 'progress' | 'events';

// Machine context
export interface WatchContext {
  runId: string;
  previousView: PreviousView;
  // State view
  stateSnapshot: JsonObject | null;
  stateTitle: string;
  stateScrollOffset: number;
  // Agent view
  selectedAgentId: string | null;
  agentChatScrollOffset: number;
  // Events
  eventsSelectedIndex: number | null;
  // Kill flow
  killError: Error | null;
  isKilled: boolean;
  // Pause/Resume feedback
  pauseResumeMessage: string | null;
  // Message flow
  messageText: string;
  messageFeedback: 'success' | 'error' | null;
}

// Event payloads
interface GoToStatePayload {
  stateSnapshot: JsonObject;
  stateTitle: string;
  fromView: PreviousView;
}

interface GoToAgentsPayload {
  selectedAgentId?: string;
  fromView: PreviousView;
}

interface GoToMessageInputPayload {
  fromView: PreviousView;
}

interface SetEventsSelectedIndexPayload {
  index: number | null;
}

interface SetStateScrollOffsetPayload {
  offset: number;
}

interface SetAgentChatScrollOffsetPayload {
  offset: number;
}

interface AgentSelectedPayload {
  agentId: string;
}

interface SetMessageTextPayload {
  text: string;
}

// ============================================================================
// Reducers
// ============================================================================

const setStateForStateView = reduce<WatchContext, GoToStatePayload>(
  (ctx, { stateSnapshot, stateTitle, fromView }) => ({
    ...ctx,
    stateSnapshot,
    stateTitle,
    stateScrollOffset: 0,
    previousView: fromView,
  })
);

const clearStateSnapshot = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  stateSnapshot: null,
}));

const setAgentForChat = reduce<WatchContext, GoToAgentsPayload>(
  (ctx, { selectedAgentId, fromView }) => ({
    ...ctx,
    selectedAgentId: selectedAgentId ?? null,
    agentChatScrollOffset: 0,
    previousView: fromView,
  })
);

const clearSelectedAgent = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  selectedAgentId: null,
}));

const setPreviousViewForMessage = reduce<WatchContext, GoToMessageInputPayload>(
  (ctx, { fromView }) => ({
    ...ctx,
    previousView: fromView,
  })
);

const setEventsSelectedIndex = reduce<WatchContext, SetEventsSelectedIndexPayload>(
  (ctx, { index }) => ({
    ...ctx,
    eventsSelectedIndex: index,
  })
);

const setStateScrollOffset = reduce<WatchContext, SetStateScrollOffsetPayload>(
  (ctx, { offset }) => ({
    ...ctx,
    stateScrollOffset: offset,
  })
);

const setAgentChatScrollOffset = reduce<WatchContext, SetAgentChatScrollOffsetPayload>(
  (ctx, { offset }) => ({
    ...ctx,
    agentChatScrollOffset: offset,
  })
);

const selectAgentFromPicker = reduce<WatchContext, AgentSelectedPayload>(
  (ctx, { agentId }) => ({
    ...ctx,
    selectedAgentId: agentId,
    agentChatScrollOffset: 0,
  })
);

const markKilled = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  isKilled: true,
}));

const setKillError = reduce<WatchContext, { error: Error }>((ctx, { error }) => ({
  ...ctx,
  killError: error,
}));

const setPauseMessage = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  pauseResumeMessage: 'Pause signal sent',
}));

const setResumeMessage = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  pauseResumeMessage: 'Resume signal sent',
}));

const clearPauseResumeMessage = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  pauseResumeMessage: null,
}));

const setMessageText = reduce<WatchContext, SetMessageTextPayload>(
  (ctx, { text }) => ({
    ...ctx,
    messageText: text,
  })
);

const clearMessageText = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  messageText: '',
}));

const setMessageSuccess = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  messageFeedback: 'success',
  messageText: '',
}));

const setMessageError = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  messageFeedback: 'error',
}));

const clearMessageFeedback = reduce<WatchContext, object>((ctx) => ({
  ...ctx,
  messageFeedback: null,
}));

// ============================================================================
// Guards
// ============================================================================

const previousViewIsProgress = guard<WatchContext, object>(
  (ctx) => ctx.previousView === 'progress'
);

const hasSelectedAgent = guard<WatchContext, object>(
  (ctx) => ctx.selectedAgentId !== null
);

// ============================================================================
// Async operation functions
// ============================================================================

const sendKillRequest = async (ctx: WatchContext) => {
  const response = await apiClient.fetch(`/brains/runs/${ctx.runId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to kill brain: ${response.status}`);
  }
  return response;
};

const sendPauseSignal = async (ctx: WatchContext) => {
  const response = await apiClient.fetch(`/brains/runs/${ctx.runId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'PAUSE' }),
  });
  if (response.status !== 202) {
    throw new Error(`Failed to pause: ${response.status}`);
  }
  return response;
};

const sendResumeSignal = async (ctx: WatchContext) => {
  const response = await apiClient.fetch(`/brains/runs/${ctx.runId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'RESUME' }),
  });
  if (response.status !== 202) {
    throw new Error(`Failed to resume: ${response.status}`);
  }
  return response;
};

const sendUserMessage = async (ctx: WatchContext) => {
  const text = ctx.messageText.trim();
  if (!text) {
    throw new Error('Message is empty');
  }
  const response = await apiClient.fetch(`/brains/runs/${ctx.runId}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'USER_MESSAGE', content: text }),
  });
  if (response.status !== 202) {
    throw new Error(`Failed to send message: ${response.status}`);
  }
  return response;
};

// ============================================================================
// State Machine Definition
// ============================================================================

const createWatchMachine = (runId: string, startWithEvents = false) =>
  createMachine(
    startWithEvents ? 'events' : 'progress',
    {
      // Main view states
      progress: state(
        transition('GO_TO_EVENTS', 'events') as any,
        transition('GO_TO_STATE', 'state', setStateForStateView) as any,
        transition('GO_TO_AGENTS', 'route-agents', setAgentForChat) as any,
        transition('GO_TO_MESSAGE_INPUT', 'message-input', setPreviousViewForMessage) as any,
        transition('INITIATE_KILL', 'confirming-kill') as any,
        transition('PAUSE', 'pausing') as any,
        transition('RESUME', 'resuming') as any
      ),

      events: state(
        transition('GO_TO_PROGRESS', 'progress') as any,
        transition('GO_TO_STATE', 'state', setStateForStateView) as any,
        transition('GO_TO_AGENTS', 'route-agents', setAgentForChat) as any,
        transition('GO_TO_MESSAGE_INPUT', 'message-input', setPreviousViewForMessage) as any,
        transition('INITIATE_KILL', 'confirming-kill') as any,
        transition('PAUSE', 'pausing') as any,
        transition('RESUME', 'resuming') as any,
        transition('SET_EVENTS_SELECTED_INDEX', 'events', setEventsSelectedIndex) as any
      ),

      state: state(
        transition('GO_BACK', 'route-back', clearStateSnapshot) as any,
        transition('SET_STATE_SCROLL_OFFSET', 'state', setStateScrollOffset) as any
      ),

      // Routing state to determine where to go back
      'route-back': state(
        immediate('progress', previousViewIsProgress) as any,
        immediate('events') as any
      ),

      // Routing state to determine if we show picker or go directly to chat
      'route-agents': state(
        immediate('agent-chat', hasSelectedAgent) as any,
        immediate('agent-picker') as any
      ),

      'agent-picker': state(
        transition('GO_BACK', 'route-back') as any,
        transition('AGENT_SELECTED', 'agent-chat', selectAgentFromPicker) as any
      ),

      'agent-chat': state(
        transition('GO_BACK', 'route-back', clearSelectedAgent) as any,
        transition('SET_AGENT_CHAT_SCROLL_OFFSET', 'agent-chat', setAgentChatScrollOffset) as any
      ),

      // Message input and sending
      'message-input': state(
        transition('GO_BACK', 'route-back', clearMessageText) as any,
        transition('SET_MESSAGE_TEXT', 'message-input', setMessageText) as any,
        transition('SEND_MESSAGE', 'sending-message') as any
      ),

      'sending-message': invoke(
        sendUserMessage,
        transition('done', 'message-sent', setMessageSuccess) as any,
        transition('error', 'message-error', setMessageError) as any
      ),

      'message-sent': state(
        transition('CLEAR_FEEDBACK', 'route-back', clearMessageFeedback) as any
      ),

      'message-error': state(
        transition('CLEAR_FEEDBACK', 'message-input', clearMessageFeedback) as any,
        transition('GO_BACK', 'route-back', clearMessageText) as any
      ),

      // Kill flow
      'confirming-kill': state(
        transition('CONFIRM_KILL', 'killing') as any,
        transition('CANCEL_KILL', 'progress') as any
      ),

      killing: invoke(
        sendKillRequest,
        transition('done', 'killed', markKilled) as any,
        transition('error', 'kill-error', setKillError) as any
      ),

      killed: state(
        // Can still navigate after kill
        transition('GO_TO_EVENTS', 'events') as any,
        transition('GO_TO_STATE', 'state', setStateForStateView) as any,
        transition('GO_TO_AGENTS', 'route-agents', setAgentForChat) as any
      ),

      'kill-error': state(
        // Can retry kill or navigate
        transition('INITIATE_KILL', 'confirming-kill') as any,
        transition('GO_TO_EVENTS', 'events') as any,
        transition('GO_TO_STATE', 'state', setStateForStateView) as any,
        transition('GO_TO_AGENTS', 'route-agents', setAgentForChat) as any
      ),

      // Pause flow
      pausing: invoke(
        sendPauseSignal,
        transition('done', 'pause-sent', setPauseMessage) as any,
        transition('error', 'progress') as any // Silently fail
      ),

      'pause-sent': state(
        transition('CLEAR_PAUSE_RESUME_MESSAGE', 'progress', clearPauseResumeMessage) as any,
        // Allow navigation while showing message
        transition('GO_TO_EVENTS', 'events', clearPauseResumeMessage) as any,
        transition('GO_TO_STATE', 'state', setStateForStateView) as any,
        transition('GO_TO_AGENTS', 'route-agents', setAgentForChat) as any
      ),

      // Resume flow
      resuming: invoke(
        sendResumeSignal,
        transition('done', 'resume-sent', setResumeMessage) as any,
        transition('error', 'progress') as any // Silently fail
      ),

      'resume-sent': state(
        transition('CLEAR_PAUSE_RESUME_MESSAGE', 'progress', clearPauseResumeMessage) as any,
        // Allow navigation while showing message
        transition('GO_TO_EVENTS', 'events', clearPauseResumeMessage) as any,
        transition('GO_TO_STATE', 'state', setStateForStateView) as any,
        transition('GO_TO_AGENTS', 'route-agents', setAgentForChat) as any
      ),
    },
    (): WatchContext => ({
      runId,
      previousView: 'progress',
      stateSnapshot: null,
      stateTitle: '',
      stateScrollOffset: 0,
      selectedAgentId: null,
      agentChatScrollOffset: 0,
      eventsSelectedIndex: null,
      killError: null,
      isKilled: false,
      pauseResumeMessage: null,
      messageText: '',
      messageFeedback: null,
    })
  );

// ============================================================================
// Helper to map machine state to ViewMode
// ============================================================================

/**
 * Map machine state name to ViewMode for rendering.
 * The machine has routing/async states that need to be mapped to display views.
 */
export function machineStateToViewMode(stateName: string): ViewMode {
  switch (stateName) {
    case 'progress':
    case 'confirming-kill':
    case 'killing':
    case 'killed':
    case 'kill-error':
    case 'pausing':
    case 'pause-sent':
    case 'resuming':
    case 'resume-sent':
      return 'progress';
    case 'events':
      return 'events';
    case 'state':
      return 'state';
    case 'agent-picker':
    case 'route-agents':
      return 'agent-picker';
    case 'agent-chat':
      return 'agent-chat';
    case 'message-input':
    case 'sending-message':
    case 'message-sent':
    case 'message-error':
      return 'message-input';
    case 'route-back':
      // Transient state, treat as progress
      return 'progress';
    default:
      return 'progress';
  }
}

/**
 * Check if the machine is in a "confirming kill" state.
 */
export function isConfirmingKill(stateName: string): boolean {
  return stateName === 'confirming-kill';
}

/**
 * Check if the machine is in a "killing" state.
 */
export function isKillingState(stateName: string): boolean {
  return stateName === 'killing';
}

/**
 * Check if the machine is in a "killed" state.
 */
export function isKilledState(stateName: string): boolean {
  return stateName === 'killed' || stateName === 'kill-error';
}

/**
 * Check if the machine is in a "pausing" state.
 */
export function isPausingState(stateName: string): boolean {
  return stateName === 'pausing';
}

/**
 * Check if the machine is in a "resuming" state.
 */
export function isResumingState(stateName: string): boolean {
  return stateName === 'resuming';
}

/**
 * Check if the machine is in a "sending message" state.
 */
export function isSendingMessageState(stateName: string): boolean {
  return stateName === 'sending-message';
}

// ============================================================================
// React Hook
// ============================================================================

/**
 * React hook for the watch UI state machine.
 * Creates a fresh machine when runId changes.
 */
export function useWatchMachine(runId: string, startWithEvents = false) {
  const machine = useMemo(
    () => createWatchMachine(runId, startWithEvents),
    [runId, startWithEvents]
  );
  return useMachine(machine);
}

// Export the machine creator for testing
export { createWatchMachine };
