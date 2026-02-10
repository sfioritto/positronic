import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { EventSource } from 'eventsource';
import type { BrainEvent, BrainErrorEvent } from '@positronic/core';
import { BRAIN_EVENTS, STATUS, reconstructBrainTree, createBrainExecutionMachine, sendEvent } from '@positronic/core';
import type { RunningBrain, StepInfo } from '@positronic/core';
import { useBrainMachine } from '../hooks/useBrainMachine.js';
import { getApiBaseUrl, isApiLocalDevMode, apiClient } from '../commands/helpers.js';
import { authenticatedFetch } from '../lib/jwt-auth.js';
import { ErrorComponent } from './error.js';
import { EventsView, type StoredEvent, type EventsViewMode } from './events-view.js';
import { StateView } from './state-view.js';
import { AgentChatView } from './agent-chat-view.js';
import { SelectList } from './select-list.js';
import { getAgentLoops } from '../utils/agent-utils.js';
import { handleKeyboardInput, type ViewMode, type WatchKeyboardContext } from './watch-keyboard.js';
import {
  useWatchMachine,
  machineStateToViewMode,
  isConfirmingKill,
  isKillingState,
  isKilledState,
  isPausingState,
  isResumingState,
  isSendingMessageState,
  type WatchContext,
  type PreviousView,
} from './watch-machine.js';

type JsonObject = { [key: string]: unknown };

// Get the index of the currently running step (or last completed if none running)
const getCurrentStepIndex = (steps: StepInfo[]): number => {
  const runningIndex = steps.findIndex((s) => s.status === STATUS.RUNNING);
  if (runningIndex >= 0) return runningIndex;

  // Find the last completed/skipped step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === STATUS.COMPLETE || steps[i].status === STATUS.SKIPPED || steps[i].status === STATUS.ERROR) {
      return i;
    }
  }
  return 0;
};

// Count completed steps
const getCompletedCount = (steps: StepInfo[]): number => {
  return steps.filter((s) => s.status === STATUS.COMPLETE || s.status === STATUS.SKIPPED).length;
};

// Get status indicator character
const getStatusChar = (status: StepInfo['status']): string => {
  switch (status) {
    case STATUS.COMPLETE:
      return '✓';
    case STATUS.SKIPPED:
      return '-';
    case STATUS.ERROR:
      return '✗';
    case STATUS.RUNNING:
      return '•';
    case STATUS.PENDING:
      return '○';
    default:
      return '?';
  }
};

// Get status color
const getStatusColor = (status: StepInfo['status']): string => {
  switch (status) {
    case STATUS.COMPLETE:
      return 'green';
    case STATUS.SKIPPED:
      return 'gray';
    case STATUS.ERROR:
      return 'red';
    case STATUS.RUNNING:
      return 'yellow';
    case STATUS.PENDING:
      return 'gray';
    default:
      return 'white';
  }
};

// Progress bar component
interface ProgressBarProps {
  completed: number;
  total: number;
  width?: number;
}

const ProgressBar = ({ completed, total, width = 20 }: ProgressBarProps) => {
  const filledWidth = total > 0 ? Math.round((completed / total) * width) : 0;
  const emptyWidth = width - filledWidth;

  return (
    <Box>
      <Text color="green">{'━'.repeat(filledWidth)}</Text>
      <Text dimColor>{'━'.repeat(emptyWidth)}</Text>
      <Text dimColor> {completed}/{total} steps</Text>
    </Box>
  );
};

// Step window component - shows prev/current/next steps
interface StepWindowProps {
  steps: StepInfo[];
  indent?: number;
}

const StepWindow = ({ steps, indent = 0 }: StepWindowProps) => {
  if (steps.length === 0) {
    return (
      <Box marginLeft={indent}>
        <Text dimColor>Waiting for steps...</Text>
      </Box>
    );
  }

  const currentIndex = getCurrentStepIndex(steps);
  const prevStep = currentIndex > 0 ? steps[currentIndex - 1] : null;
  const currentStep = steps[currentIndex];
  const nextStep = currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null;

  return (
    <Box flexDirection="column" marginLeft={indent}>
      {prevStep && (
        <Box>
          <Text color={getStatusColor(prevStep.status)}>
            {getStatusChar(prevStep.status)} {prevStep.title}
          </Text>
        </Box>
      )}
      {currentStep && (
        <Box>
          <Text color={getStatusColor(currentStep.status)} bold>
            {getStatusChar(currentStep.status)} {currentStep.title}
          </Text>
        </Box>
      )}
      {nextStep && (
        <Box>
          <Text color={getStatusColor(nextStep.status)}>
            {getStatusChar(nextStep.status)} {nextStep.title}
          </Text>
        </Box>
      )}
    </Box>
  );
};

// Brain section component - header + step window + progress bar
interface BrainSectionProps {
  brain: RunningBrain;
  isInner?: boolean;
}

const BrainSection = ({ brain, isInner = false }: BrainSectionProps) => {
  const indent = isInner ? 2 : 0;
  const completed = getCompletedCount(brain.steps);
  const total = brain.steps.length;

  const { innerBrain } = brain;

  return (
    <Box flexDirection="column" marginLeft={indent}>
      {/* Header */}
      <Box marginBottom={1}>
        {isInner ? (
          <Text dimColor>└─ </Text>
        ) : null}
        <Text bold>{brain.brainTitle}</Text>
      </Box>

      {/* Step window */}
      <StepWindow steps={brain.steps} indent={1} />

      {/* Progress bar */}
      <Box marginTop={1}>
        <Box marginLeft={1}>
          <ProgressBar completed={completed} total={total} />
        </Box>
      </Box>

      {/* Inner brain section (if running) */}
      {innerBrain && (
        <Box marginTop={1}>
          <BrainSection brain={innerBrain} isInner={true} />
        </Box>
      )}
    </Box>
  );
};

interface WatchProps {
  runId: string;
  manageScreenBuffer?: boolean;
  footer?: string;
  startWithEvents?: boolean;
}

export const Watch = ({ runId, manageScreenBuffer = true, footer, startWithEvents = false }: WatchProps) => {
  const { write } = useStdout();
  const { exit } = useApp();

  // UI navigation state machine - handles view transitions and related context
  const [watchState, sendWatch] = useWatchMachine(runId, startWithEvents);

  // Derive viewMode from machine state
  const viewMode = machineStateToViewMode(watchState.name);

  // Read navigation and async operation state from machine context
  const {
    previousView: previousViewMode,
    stateSnapshot,
    stateTitle,
    stateScrollOffset,
    selectedAgentId,
    agentChatScrollOffset,
    eventsSelectedIndex,
    killError,
    isKilled,
    pauseResumeMessage,
    messageText,
    messageFeedback: messageSentFeedback,
  } = watchState.context;

  // Derive async operation flags from machine state
  const confirmingKill = isConfirmingKill(watchState.name);
  const isKilling = isKillingState(watchState.name);
  const isPausing = isPausingState(watchState.name);
  const isResuming = isResumingState(watchState.name);
  const isSendingMessage = isSendingMessageState(watchState.name);

  // Events array (large, not navigation state)
  const [events, setEvents] = useState<StoredEvent[]>([]);
  // Events view mode (delegated to EventsView component)
  const [eventsViewMode, setEventsViewMode] = useState<EventsViewMode>('auto');

  // Use state machine to track brain execution state
  // Machine is recreated when runId changes, giving us fresh context
  const [current, send] = useBrainMachine(runId);

  // Keep a ref to the latest send function to avoid stale closure issues
  // When runId changes, useMachine updates send asynchronously, but our EventSource
  // effect runs immediately. Using a ref ensures we always call the current send.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Read brain state directly from machine context - useMachine handles re-renders
  const { brains, brainIdStack, isComplete } = current.context;
  // Reconstruct the tree for UI display - this is O(depth) but depth is tiny
  const rootBrain = reconstructBrainTree(brains, brainIdStack);

  // Additional state for connection and errors (not part of the brain state machine)
  const [brainError, setBrainError] = useState<BrainErrorEvent | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Track paused status from brain state machine
  const isPaused = current.context.status === STATUS.PAUSED;

  // Enter alternate screen buffer on mount, exit on unmount
  // Skip in test environment or when parent manages screen buffer
  useEffect(() => {
    if (process.env.NODE_ENV === 'test' || !manageScreenBuffer) {
      return;
    }

    // Enter alternate screen buffer and clear
    write('\x1B[?1049h\x1B[2J\x1B[H');

    return () => {
      // Exit alternate screen buffer
      write('\x1B[?1049l');
    };
  }, [write, manageScreenBuffer]);

  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/brains/runs/${runId}/watch`;

    const es = new EventSource(url, { fetch: authenticatedFetch });

    // Reset connection state for new connection
    // Note: rootBrain and isComplete are handled by the new machine (via useMemo)
    setIsConnected(false);
    setConnectionError(null);
    setBrainError(undefined);

    es.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const eventData = JSON.parse(event.data) as BrainEvent;

        // Store event for events view (keep last 500 events to prevent memory issues)
        setEvents((prev) => {
          const newEvents = [...prev, { timestamp: new Date(), event: eventData }];
          return newEvents.slice(-500);
        });

        // Send event to state machine - useMachine handles re-renders automatically
        // Use ref to ensure we always call the latest send function
        sendRef.current(eventData);

        // Capture error event for display (error state is separate from machine)
        if (eventData.type === BRAIN_EVENTS.ERROR) {
          setBrainError(eventData as BrainErrorEvent);
        }
      } catch (e: any) {
        setConnectionError(new Error(`Error parsing event data: ${e.message}`));
      }
    };

    es.onerror = () => {
      const errorMessage = isApiLocalDevMode()
        ? `Connection to ${url} failed. Ensure the local development server is running ('positronic server' or 'px s').`
        : `Connection to ${url} failed. Please check your network connection and verify the project URL is correct.`;
      setConnectionError(new Error(errorMessage));
      setIsConnected(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId]);

  // Handler for viewing state at a specific event index (called from EventsView)
  const handleViewStateAtEvent = (eventIndex: number) => {
    // Store selected index before transitioning
    sendWatch({ type: 'SET_EVENTS_SELECTED_INDEX', index: eventIndex });
    // Use the brain state machine to reconstruct state at this point
    const machine = createBrainExecutionMachine();
    for (let i = 0; i <= eventIndex && i < events.length; i++) {
      sendEvent(machine, events[i].event);
    }
    // Transition to state view with the reconstructed state
    sendWatch({
      type: 'GO_TO_STATE',
      stateSnapshot: machine.context.currentState,
      stateTitle: `State at event #${eventIndex + 1}`,
      fromView: 'events' as PreviousView,
    });
  };

  // Handler for sending a USER_MESSAGE signal
  const handleSendMessage = () => {
    if (!messageText.trim() || isSendingMessage) return;
    // Trigger the machine's sending-message invoke state
    sendWatch({ type: 'SEND_MESSAGE' });
  };

  // Auto-clear message feedback after success
  useEffect(() => {
    if (messageSentFeedback === 'success') {
      const timer = setTimeout(() => {
        sendWatch({ type: 'CLEAR_FEEDBACK' });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [messageSentFeedback, sendWatch]);

  // Auto-clear pause/resume message after showing
  useEffect(() => {
    if (pauseResumeMessage) {
      const timer = setTimeout(() => {
        sendWatch({ type: 'CLEAR_PAUSE_RESUME_MESSAGE' });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [pauseResumeMessage, sendWatch]);

  // Build keyboard context for the handler
  const brainTitle = rootBrain?.brainTitle;
  const agentLoops = getAgentLoops(events, brainTitle);
  const hasAgents = agentLoops.length > 0;

  // Keyboard handling - uses extracted handler for event mapping
  useInput((input, key) => {
    const keyboardContext: WatchKeyboardContext = {
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
    };

    const event = handleKeyboardInput(input, key, keyboardContext);
    if (!event) return;

    // Handle each event type - forward to the state machine
    switch (event.type) {
      case 'CONFIRM_KILL':
        sendWatch({ type: 'CONFIRM_KILL' });
        break;

      case 'CANCEL_KILL':
        sendWatch({ type: 'CANCEL_KILL' });
        break;

      case 'GO_BACK':
        sendWatch({ type: 'GO_BACK' });
        break;

      case 'CANCEL_MESSAGE_INPUT':
        sendWatch({ type: 'GO_BACK' });
        break;

      case 'GO_TO_EVENTS':
        sendWatch({ type: 'GO_TO_EVENTS' });
        break;

      case 'GO_TO_PROGRESS':
        sendWatch({ type: 'GO_TO_PROGRESS' });
        break;

      case 'GO_TO_STATE': {
        const currentState = current.context.currentState ?? {};
        sendWatch({
          type: 'GO_TO_STATE',
          stateSnapshot: currentState,
          stateTitle: 'Current State',
          fromView: 'progress' as PreviousView,
        });
        break;
      }

      case 'INITIATE_KILL':
        sendWatch({ type: 'INITIATE_KILL' });
        break;

      case 'GO_TO_AGENTS': {
        const fromView = (viewMode === 'events' ? 'events' : 'progress') as PreviousView;
        if (agentLoops.length === 1) {
          // Go directly to chat view for single agent
          sendWatch({
            type: 'GO_TO_AGENTS',
            selectedAgentId: agentLoops[0].stepId,
            fromView,
          });
        } else {
          // Show picker for multiple agents
          sendWatch({
            type: 'GO_TO_AGENTS',
            fromView,
          });
        }
        break;
      }

      case 'GO_TO_MESSAGE_INPUT': {
        const fromView = (viewMode === 'events' ? 'events' : 'progress') as PreviousView;
        sendWatch({ type: 'GO_TO_MESSAGE_INPUT', fromView });
        break;
      }

      case 'PAUSE':
        sendWatch({ type: 'PAUSE' });
        break;

      case 'RESUME':
        sendWatch({ type: 'RESUME' });
        break;

      case 'QUIT':
        exit();
        break;
    }
  });

  // Prepare error props using destructuring
  const connectionErrorProps = connectionError
    ? { title: 'Connection Error', message: connectionError.message, details: connectionError.stack }
    : null;
  const brainErrorProps = brainError
    ? { title: brainError.error.name || 'Brain Error', ...brainError.error }
    : null;

  // Prepare kill error props
  const killErrorProps = killError
    ? { title: 'Kill Error', message: killError.message }
    : null;

  // Build footer based on current mode
  const getFooter = () => {
    const canSendMessage = hasAgents && !isComplete;

    if (viewMode === 'state') {
      return 'j/k scroll | space/shift+space page | b back';
    } else if (viewMode === 'agent-chat') {
      return 'j/k scroll | space/shift+space page | b back';
    } else if (viewMode === 'agent-picker') {
      return 'j/k select | Enter view | b back';
    } else if (viewMode === 'message-input') {
      return 'Enter send | Esc cancel';
    } else if (viewMode === 'events') {
      if (eventsViewMode === 'detail') {
        return 'j/k scroll • b back';
      } else if (eventsViewMode === 'navigating') {
        const msgPart = canSendMessage ? ' | m message' : '';
        return `j/k select | Enter detail | s state | a agents${msgPart} | b back | esc auto-scroll`;
      } else {
        const msgPart = canSendMessage ? ' | m message' : '';
        return `j/k select | a agents${msgPart} | b back | x kill | esc quit`;
      }
    } else {
      const msgPart = canSendMessage ? ' | m message' : '';
      const pauseResumePart = isPaused ? ' | r resume' : (!isComplete ? ' | p pause' : '');
      return `s state | e events | a agents${pauseResumePart}${msgPart} | x kill | esc quit`;
    }
  };

  const displayFooter = footer ?? getFooter();

  return (
    <Box flexDirection="column">
      {!isConnected && !rootBrain ? (
        <Text>Connecting to watch service...</Text>
      ) : viewMode === 'state' && stateSnapshot !== null ? (
        <>
          <StateView
            state={stateSnapshot}
            title={stateTitle}
            scrollOffset={stateScrollOffset}
            onScrollChange={(offset) => sendWatch({ type: 'SET_STATE_SCROLL_OFFSET', offset })}
            isActive={viewMode === 'state'}
          />
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
        </>
      ) : viewMode === 'agent-picker' ? (
        <>
          <SelectList
            items={agentLoops.map((agent) => ({
              id: agent.stepId,
              label: agent.label,
              description: `${agent.rawResponseEvents.length} response(s)`,
            }))}
            header="Select an agent to view:"
            onSelect={(item) => {
              sendWatch({ type: 'AGENT_SELECTED', agentId: item.id });
            }}
            onCancel={() => sendWatch({ type: 'GO_BACK' })}
            footer="j/k select | Enter view | b back"
          />
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
        </>
      ) : viewMode === 'agent-chat' && selectedAgentId ? (
        (() => {
          const selectedAgent = agentLoops.find((a) => a.stepId === selectedAgentId);
          if (!selectedAgent) {
            return <Text>Agent not found</Text>;
          }
          return (
            <>
              <AgentChatView
                label={selectedAgent.label}
                agentStartEvent={selectedAgent.startEvent}
                rawResponseEvents={selectedAgent.rawResponseEvents}
                scrollOffset={agentChatScrollOffset}
                onScrollChange={(offset) => sendWatch({ type: 'SET_AGENT_CHAT_SCROLL_OFFSET', offset })}
                isActive={viewMode === 'agent-chat'}
              />
              {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
              {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
            </>
          );
        })()
      ) : viewMode === 'events' ? (
        <>
          <EventsView
            events={events}
            totalTokens={current.context.totalTokens}
            isActive={viewMode === 'events'}
            onModeChange={setEventsViewMode}
            onViewState={handleViewStateAtEvent}
            selectedIndex={eventsSelectedIndex}
            onSelectedIndexChange={(index) => sendWatch({ type: 'SET_EVENTS_SELECTED_INDEX', index })}
          />
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
        </>
      ) : viewMode === 'message-input' ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Send message to agent:</Text>
          </Box>
          <Box>
            <Text color="cyan">&gt; </Text>
            <TextInput
              value={messageText}
              onChange={(text) => sendWatch({ type: 'SET_MESSAGE_TEXT', text })}
              onSubmit={handleSendMessage}
              focus={true}
            />
          </Box>
          {isSendingMessage && (
            <Box marginTop={1}>
              <Text color="yellow">Sending...</Text>
            </Box>
          )}
          {messageSentFeedback === 'success' && (
            <Box marginTop={1}>
              <Text color="green">Message sent!</Text>
            </Box>
          )}
          {messageSentFeedback === 'error' && (
            <Box marginTop={1}>
              <Text color="red">Failed to send message</Text>
            </Box>
          )}
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
        </Box>
      ) : !rootBrain ? (
        <Text>Waiting for brain to start...</Text>
      ) : (
        <>
          <BrainSection brain={rootBrain} />

          {confirmingKill && (
            <Box marginTop={1}>
              <Text color="yellow">Kill brain? (y/n)</Text>
            </Box>
          )}
          {isKilling && (
            <Box marginTop={1}>
              <Text color="yellow">Killing brain...</Text>
            </Box>
          )}
          {isKilled && (
            <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
              <Text color="red">Brain killed.</Text>
            </Box>
          )}
          {isPaused && !isKilled && (
            <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
              <Text color="cyan">Brain paused. Press 'r' to resume.</Text>
            </Box>
          )}
          {isPausing && (
            <Box marginTop={1}>
              <Text color="yellow">Sending pause signal...</Text>
            </Box>
          )}
          {isResuming && (
            <Box marginTop={1}>
              <Text color="yellow">Sending resume signal...</Text>
            </Box>
          )}
          {pauseResumeMessage && !isPausing && !isResuming && (
            <Box marginTop={1}>
              <Text color="cyan">{pauseResumeMessage}</Text>
            </Box>
          )}
          {isComplete && !connectionError && !brainError && !isKilled && (
            <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
              <Text color="green">Brain completed.</Text>
            </Box>
          )}
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
          {killErrorProps && <ErrorComponent error={killErrorProps} />}
        </>
      )}
      <Box marginTop={1}>
        <Text dimColor>{displayFooter}</Text>
      </Box>
    </Box>
  );
};
