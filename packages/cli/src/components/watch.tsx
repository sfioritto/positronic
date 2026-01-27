import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { EventSource } from 'eventsource';
import type { BrainEvent, BrainErrorEvent } from '@positronic/core';
import { BRAIN_EVENTS, STATUS, reconstructBrainTree, createBrainExecutionMachine, sendEvent } from '@positronic/core';
import type { RunningBrain, StepInfo } from '@positronic/core';
import { useBrainMachine } from '../hooks/useBrainMachine.js';
import { getApiBaseUrl, isApiLocalDevMode, apiClient } from '../commands/helpers.js';
import { useApiDelete } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { EventsView, type StoredEvent, type EventsViewMode } from './events-view.js';
import { StateView } from './state-view.js';
import { AgentChatView } from './agent-chat-view.js';
import { SelectList } from './select-list.js';
import { getAgentLoops } from '../utils/agent-utils.js';

type JsonObject = { [key: string]: unknown };

type ViewMode = 'progress' | 'events' | 'state' | 'agent-picker' | 'agent-chat' | 'message-input';

// Get the index of the currently running step (or last completed if none running)
const getCurrentStepIndex = (steps: StepInfo[]): number => {
  const runningIndex = steps.findIndex((s) => s.status === STATUS.RUNNING);
  if (runningIndex >= 0) return runningIndex;

  // Find the last completed step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === STATUS.COMPLETE || steps[i].status === STATUS.ERROR) {
      return i;
    }
  }
  return 0;
};

// Count completed steps
const getCompletedCount = (steps: StepInfo[]): number => {
  return steps.filter((s) => s.status === STATUS.COMPLETE).length;
};

// Get status indicator character
const getStatusChar = (status: StepInfo['status']): string => {
  switch (status) {
    case STATUS.COMPLETE:
      return '✓';
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

  // View mode state (progress view vs events log vs state view)
  const [viewMode, setViewMode] = useState<ViewMode>(startWithEvents ? 'events' : 'progress');
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [eventsViewMode, setEventsViewMode] = useState<EventsViewMode>('auto');

  // State view state
  const [stateSnapshot, setStateSnapshot] = useState<JsonObject | null>(null);
  const [stateTitle, setStateTitle] = useState<string>('');
  const [stateScrollOffset, setStateScrollOffset] = useState(0);
  const [previousViewMode, setPreviousViewMode] = useState<'progress' | 'events'>('progress');

  // Agent chat view state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentChatScrollOffset, setAgentChatScrollOffset] = useState(0);

  // Message input state
  const [messageText, setMessageText] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [messageSentFeedback, setMessageSentFeedback] = useState<'success' | 'error' | null>(null);

  // Track selected event index so it persists across view changes
  const [eventsSelectedIndex, setEventsSelectedIndex] = useState<number | null>(null);

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

  // Kill state
  const [confirmingKill, setConfirmingKill] = useState(false);
  const [isKilling, setIsKilling] = useState(false);
  const [isKilled, setIsKilled] = useState(false);
  const { execute: killBrain, error: killError } = useApiDelete('brain');

  // Pause/resume state
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [pauseResumeMessage, setPauseResumeMessage] = useState<string | null>(null);

  // Track paused status from state machine
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
    const es = new EventSource(url);

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
    setEventsSelectedIndex(eventIndex);  // Preserve selection for when we return
    // Use the state machine to reconstruct state at this point
    const machine = createBrainExecutionMachine();
    for (let i = 0; i <= eventIndex && i < events.length; i++) {
      sendEvent(machine, events[i].event);
    }
    setStateSnapshot(machine.context.currentState);
    setStateTitle(`State at event #${eventIndex + 1}`);
    setStateScrollOffset(0);
    setPreviousViewMode('events');
    setViewMode('state');
  };

  // Handler for sending a USER_MESSAGE signal
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isSendingMessage) return;

    setIsSendingMessage(true);
    setMessageSentFeedback(null);

    try {
      const response = await apiClient.fetch(`/brains/runs/${runId}/signals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'USER_MESSAGE', content: text.trim() }),
      });

      if (response.status === 202) {
        setMessageSentFeedback('success');
        setMessageText('');
        // Brief feedback then return to previous view
        setTimeout(() => {
          setMessageSentFeedback(null);
          setViewMode(previousViewMode);
        }, 1000);
      } else {
        setMessageSentFeedback('error');
      }
    } catch {
      setMessageSentFeedback('error');
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Keyboard handling
  useInput((input, key) => {
    if (confirmingKill) {
      if (input === 'y') {
        setConfirmingKill(false);
        setIsKilling(true);
        killBrain(`/brains/runs/${runId}`)
          .then(() => {
            setIsKilled(true);
          })
          .catch(() => {
            // Error is already captured in killError state from useApiDelete hook
          })
          .finally(() => {
            setIsKilling(false);
          });
      } else if (input === 'n' || key.escape) {
        setConfirmingKill(false);
      }
    } else if (viewMode === 'state') {
      // State view: 'b' goes back to previous view
      if (input === 'b') {
        setViewMode(previousViewMode);
        setStateSnapshot(null);
      }
      // j/k scrolling is handled by StateView component
    } else if (viewMode === 'agent-chat') {
      // Agent chat view: 'b' or escape goes back to previous view
      if (input === 'b' || key.escape) {
        setViewMode(previousViewMode);
        setSelectedAgentId(null);
      }
      // j/k scrolling is handled by AgentChatView component
    } else if (viewMode === 'agent-picker') {
      // Agent picker: 'b' or escape goes back to previous view
      // SelectList handles its own navigation (up/down/enter)
      if (input === 'b' || key.escape) {
        setViewMode(previousViewMode);
      }
    } else if (viewMode === 'message-input') {
      // Message input mode: Escape cancels
      // TextInput handles its own input and Enter (onSubmit)
      if (key.escape) {
        setMessageText('');
        setViewMode(previousViewMode);
      }
    } else {
      // View toggle
      if (input === 'e') {
        setViewMode('events');
      } else if (input === 'w' || (input === 'b' && viewMode === 'events' && eventsViewMode !== 'detail')) {
        // 'b' in events list mode goes back to progress view
        // 'b' in events detail mode is handled by EventsView to go back to list
        setViewMode('progress');
      } else if (input === 's' && viewMode === 'progress') {
        // 's' from progress view: show current state
        const currentState = current.context.currentState ?? {};
        setStateSnapshot(currentState);
        setStateTitle('Current State');
        setStateScrollOffset(0);
        setPreviousViewMode('progress');
        setViewMode('state');
      } else if (input === 'x' && !isKilling && !isKilled && !isComplete) {
        setConfirmingKill(true);
      } else if (input === 'a' || input === 'A') {
        // Show agent chat view
        const brainTitle = rootBrain?.brainTitle;
        const agentLoops = getAgentLoops(events, brainTitle);
        if (agentLoops.length === 0) {
          return; // No agents - ignore keypress
        }
        if (agentLoops.length === 1) {
          // Go directly to chat view for single agent
          setSelectedAgentId(agentLoops[0].stepId);
          setAgentChatScrollOffset(0);
          setPreviousViewMode(viewMode === 'events' ? 'events' : 'progress');
          setViewMode('agent-chat');
        } else {
          // Show picker for multiple agents
          setPreviousViewMode(viewMode === 'events' ? 'events' : 'progress');
          setViewMode('agent-picker');
        }
      } else if (input === 'm' && !isComplete) {
        // Enter message input mode (only when brain is running and has agent loops)
        const brainTitle = rootBrain?.brainTitle;
        const agentLoops = getAgentLoops(events, brainTitle);
        if (agentLoops.length > 0) {
          setPreviousViewMode(viewMode === 'events' ? 'events' : 'progress');
          setViewMode('message-input');
        }
      } else if (input === 'p' && !isComplete && !isPaused && !isPausing) {
        // Pause the brain
        setIsPausing(true);
        apiClient.fetch(`/brains/runs/${runId}/signals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'PAUSE' }),
        })
          .then((res) => {
            if (res.status === 202) {
              setPauseResumeMessage('Pause signal sent');
              setTimeout(() => setPauseResumeMessage(null), 2000);
            }
          })
          .catch(() => {
            // Silently ignore - user can retry
          })
          .finally(() => setIsPausing(false));
      } else if (input === 'r' && isPaused && !isResuming) {
        // Resume the brain
        setIsResuming(true);
        apiClient.fetch(`/brains/runs/${runId}/signals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'RESUME' }),
        })
          .then((res) => {
            if (res.status === 202) {
              setPauseResumeMessage('Resume signal sent');
              setTimeout(() => setPauseResumeMessage(null), 2000);
            }
          })
          .catch(() => {
            // Silently ignore - user can retry
          })
          .finally(() => setIsResuming(false));
      } else if ((input === 'q' || key.escape) && manageScreenBuffer) {
        // Only handle quit when standalone (manageScreenBuffer=true)
        // When embedded, parent handles q/escape
        exit();
      }
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
    ? { title: 'Kill Error', message: killError.message, details: killError.details }
    : null;

  // Build footer based on current mode
  const getFooter = () => {
    const brainTitle = rootBrain?.brainTitle;
    const agentLoops = getAgentLoops(events, brainTitle);
    const hasAgents = agentLoops.length > 0;
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
            onScrollChange={setStateScrollOffset}
            isActive={viewMode === 'state'}
          />
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
        </>
      ) : viewMode === 'agent-picker' ? (
        (() => {
          const brainTitle = rootBrain?.brainTitle;
          const agentLoops = getAgentLoops(events, brainTitle);
          return (
            <>
              <SelectList
                items={agentLoops.map((agent) => ({
                  id: agent.stepId,
                  label: agent.label,
                  description: `${agent.rawResponseEvents.length} response(s)`,
                }))}
                header="Select an agent to view:"
                onSelect={(item) => {
                  setSelectedAgentId(item.id);
                  setAgentChatScrollOffset(0);
                  setViewMode('agent-chat');
                }}
                onCancel={() => setViewMode(previousViewMode)}
                footer="j/k select | Enter view | b back"
              />
              {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
              {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
            </>
          );
        })()
      ) : viewMode === 'agent-chat' && selectedAgentId ? (
        (() => {
          const brainTitle = rootBrain?.brainTitle;
          const agentLoops = getAgentLoops(events, brainTitle);
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
                onScrollChange={setAgentChatScrollOffset}
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
            onSelectedIndexChange={setEventsSelectedIndex}
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
              onChange={setMessageText}
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
