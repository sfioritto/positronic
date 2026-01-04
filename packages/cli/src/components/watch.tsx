import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout } from 'ink';
import { EventSource } from 'eventsource';
import type { BrainEvent, StepStatusEvent, BrainStartEvent, BrainErrorEvent, BrainCompleteEvent, StepStartedEvent } from '@positronic/core';
import { BRAIN_EVENTS } from '@positronic/core';
import type { SerializedStep } from '@positronic/core';
import { STATUS } from '@positronic/core';
import { getApiBaseUrl, isApiLocalDevMode } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';

type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

// State for tracking each brain (parent and inner brains)
interface BrainState {
  brainRunId: string;
  brainTitle: string;
  steps: SerializedStepStatus[];
  parentStepId: string | null; // Which parent step spawned this brain (null for main brain)
  isComplete: boolean;
}

// Get the index of the currently running step (or last completed if none running)
const getCurrentStepIndex = (steps: SerializedStepStatus[]): number => {
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
const getCompletedCount = (steps: SerializedStepStatus[]): number => {
  return steps.filter((s) => s.status === STATUS.COMPLETE).length;
};

// Get status indicator character
const getStatusChar = (status: SerializedStepStatus['status']): string => {
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
const getStatusColor = (status: SerializedStepStatus['status']): string => {
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
  steps: SerializedStepStatus[];
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
  brain: BrainState;
  isInner?: boolean;
  brains: Map<string, BrainState>;
}

const BrainSection = ({ brain, isInner = false, brains }: BrainSectionProps) => {
  const indent = isInner ? 2 : 0;
  const completed = getCompletedCount(brain.steps);
  const total = brain.steps.length;

  // Find the currently running step to check for inner brain
  const currentIndex = getCurrentStepIndex(brain.steps);
  const currentStep = brain.steps[currentIndex];

  // Find any inner brain associated with the current step
  const innerBrain = currentStep
    ? Array.from(brains.values()).find((b) => b.parentStepId === currentStep.id && !b.isComplete)
    : null;

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
          <BrainSection brain={innerBrain} isInner={true} brains={brains} />
        </Box>
      )}
    </Box>
  );
};

interface WatchProps {
  runId: string;
}

export const Watch = ({ runId }: WatchProps) => {
  const { write } = useStdout();

  // Track all brains (parent and inner) by their brainRunId
  const [brains, setBrains] = useState<Map<string, BrainState>>(new Map());
  const [brainError, setBrainError] = useState<BrainErrorEvent | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  // Track the main brain's brainRunId to distinguish from inner brain events
  const mainBrainRunIdRef = useRef<string | null>(null);
  // Track the currently running step ID to associate inner brains with their parent step
  const runningStepIdRef = useRef<string | null>(null);

  // Enter alternate screen buffer on mount, exit on unmount
  // Skip in test environment to avoid interfering with test output capture
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Enter alternate screen buffer and clear
    write('\x1B[?1049h\x1B[2J\x1B[H');

    return () => {
      // Exit alternate screen buffer
      write('\x1B[?1049l');
    };
  }, [write]);

  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/brains/runs/${runId}/watch`;
    const es = new EventSource(url);

    setIsConnected(false);
    setError(null);
    setBrains(new Map());
    mainBrainRunIdRef.current = null;
    runningStepIdRef.current = null;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const eventData = JSON.parse(event.data) as BrainEvent;

        // Handle brain start - register new brain (parent or inner)
        if (
          eventData.type === BRAIN_EVENTS.START ||
          eventData.type === BRAIN_EVENTS.RESTART
        ) {
          const startEvent = eventData as BrainStartEvent;
          const isMainBrain = mainBrainRunIdRef.current === null;

          if (isMainBrain) {
            mainBrainRunIdRef.current = startEvent.brainRunId;
          }

          setBrains((prev) => {
            const next = new Map(prev);
            next.set(startEvent.brainRunId, {
              brainRunId: startEvent.brainRunId,
              brainTitle: startEvent.brainTitle,
              steps: [],
              parentStepId: isMainBrain ? null : runningStepIdRef.current,
              isComplete: false,
            });
            return next;
          });

          setIsCompleted(false);
        }

        // Handle step status - update steps for the specific brain only
        if (eventData.type === BRAIN_EVENTS.STEP_STATUS) {
          const statusEvent = eventData as StepStatusEvent;
          setBrains((prev) => {
            const next = new Map(prev);
            const brain = next.get(statusEvent.brainRunId);
            if (brain) {
              next.set(statusEvent.brainRunId, { ...brain, steps: statusEvent.steps });
            }
            return next;
          });
        }

        // Handle step start - track the running step for inner brain association
        if (eventData.type === BRAIN_EVENTS.STEP_START) {
          const stepEvent = eventData as StepStartedEvent;
          runningStepIdRef.current = stepEvent.stepId;
        }

        // Mark brain as complete when it completes
        if (eventData.type === BRAIN_EVENTS.COMPLETE || eventData.type === BRAIN_EVENTS.ERROR) {
          const completeEvent = eventData as BrainCompleteEvent | BrainErrorEvent;

          // Mark this brain as complete
          setBrains((prev) => {
            const next = new Map(prev);
            const brain = next.get(completeEvent.brainRunId);
            if (brain) {
              next.set(completeEvent.brainRunId, { ...brain, isComplete: true });
            }
            return next;
          });

          // Only mark overall as complete when the main brain completes
          if (completeEvent.brainRunId === mainBrainRunIdRef.current) {
            setIsCompleted(true);
          }
        }

        if (eventData.type === BRAIN_EVENTS.ERROR) {
          const errorEvent = eventData as BrainErrorEvent;
          // Only show error for the main brain
          if (errorEvent.brainRunId === mainBrainRunIdRef.current) {
            setBrainError(errorEvent);
          }
        }
      } catch (e: any) {
        setError(new Error(`Error parsing event data: ${e.message}`));
      }
    };

    es.onerror = () => {
      const errorMessage = isApiLocalDevMode()
        ? `Connection to ${url} failed. Ensure the local development server is running ('positronic server' or 'px s').`
        : `Connection to ${url} failed. Please check your network connection and verify the project URL is correct.`;
      setError(new Error(errorMessage));
      setIsConnected(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId]);

  const mainBrain = mainBrainRunIdRef.current ? brains.get(mainBrainRunIdRef.current) : null;

  return (
    <Box flexDirection="column">
      {!isConnected && brains.size === 0 ? (
        <Text>Connecting to watch service...</Text>
      ) : !mainBrain ? (
        <Text>Waiting for brain to start...</Text>
      ) : (
        <>
          <BrainSection brain={mainBrain} brains={brains} />

          {isCompleted && !error && !brainError && (
            <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
              <Text color="green">Brain completed.</Text>
            </Box>
          )}
          {error && (
            <ErrorComponent
              error={{
                title: 'Connection Error',
                message: error.message,
                details: error.stack,
              }}
            />
          )}
          {brainError && (
            <ErrorComponent
              error={{
                title: brainError.error.name || 'Brain Error',
                message: brainError.error.message,
                details: brainError.error.stack,
              }}
            />
          )}
        </>
      )}
    </Box>
  );
};
