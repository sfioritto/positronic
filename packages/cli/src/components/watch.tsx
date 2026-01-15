import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout } from 'ink';
import { EventSource } from 'eventsource';
import type { BrainEvent, BrainErrorEvent, BrainStateMachine } from '@positronic/core';
import {
  BRAIN_EVENTS,
  STATUS,
  createBrainExecutionMachine,
  sendEvent,
} from '@positronic/core';
import type { RunningBrain, StepInfo } from '@positronic/core';
import { getApiBaseUrl, isApiLocalDevMode } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';

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
}

export const Watch = ({ runId }: WatchProps) => {
  const { write } = useStdout();

  // Use state machine to track brain execution state
  const machineRef = useRef<BrainStateMachine>(createBrainExecutionMachine());

  // React state extracted from machine context - updated on each event
  const [rootBrain, setRootBrain] = useState<RunningBrain | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  // Additional state for connection and errors (not part of the brain state machine)
  const [brainError, setBrainError] = useState<BrainErrorEvent | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

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

    // Reset state machine for new connection
    machineRef.current = createBrainExecutionMachine();
    setIsConnected(false);
    setConnectionError(null);
    setRootBrain(null);
    setBrainError(undefined);
    setIsComplete(false);

    es.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const eventData = JSON.parse(event.data) as BrainEvent;
        const machine = machineRef.current;

        // Feed event to state machine - it handles all the state tracking
        sendEvent(machine, eventData);

        // Update React state from machine context to trigger re-render
        const { rootBrain: newRootBrain, isComplete: newIsComplete } = machine.context;
        if (newRootBrain) {
          setRootBrain(newRootBrain);
        }

        // Check for completion (outer brain)
        if (newIsComplete) {
          setIsComplete(true);
        }

        // Check for error (capture the error event for display)
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

  // Prepare error props using destructuring
  const connectionErrorProps = connectionError
    ? { title: 'Connection Error', message: connectionError.message, details: connectionError.stack }
    : null;
  const brainErrorProps = brainError
    ? { title: brainError.error.name || 'Brain Error', ...brainError.error }
    : null;

  return (
    <Box flexDirection="column">
      {!isConnected && !rootBrain ? (
        <Text>Connecting to watch service...</Text>
      ) : !rootBrain ? (
        <Text>Waiting for brain to start...</Text>
      ) : (
        <>
          <BrainSection brain={rootBrain} />

          {isComplete && !connectionError && !brainError && (
            <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
              <Text color="green">Brain completed.</Text>
            </Box>
          )}
          {connectionErrorProps && <ErrorComponent error={connectionErrorProps} />}
          {brainErrorProps && <ErrorComponent error={brainErrorProps} />}
        </>
      )}
    </Box>
  );
};
