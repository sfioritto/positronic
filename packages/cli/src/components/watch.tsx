import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useStdout } from 'ink';
import { EventSource } from 'eventsource';
import type { BrainEvent, BrainErrorEvent } from '@positronic/core';
import {
  BRAIN_EVENTS,
  STATUS,
  createBrainExecutionMachine,
  sendEvent,
} from '@positronic/core';
import type { BrainStateMachine, BrainStackEntry, StepInfo } from '@positronic/core';
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
  brain: BrainStackEntry;
  isInner?: boolean;
  brainStack: BrainStackEntry[];
}

const BrainSection = ({ brain, isInner = false, brainStack }: BrainSectionProps) => {
  const indent = isInner ? 2 : 0;
  const completed = getCompletedCount(brain.steps);
  const total = brain.steps.length;

  // Find the currently running step to check for inner brain
  const currentIndex = getCurrentStepIndex(brain.steps);
  const currentStep = brain.steps[currentIndex];

  // Find any inner brain associated with the current step (active inner brains are on the stack)
  // Must exclude the current brain to prevent infinite recursion when a restarted brain
  // has parentStepId matching its own step IDs
  const innerBrain = currentStep
    ? brainStack.find((b) => b.parentStepId === currentStep.id && b !== brain)
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
          <BrainSection brain={innerBrain} isInner={true} brainStack={brainStack} />
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
  // Store brain stack in state to trigger re-renders when it changes
  const [brainStack, setBrainStack] = useState<BrainStackEntry[]>([]);
  const [brainError, setBrainError] = useState<BrainErrorEvent | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

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
    setError(null);
    setBrainStack([]);
    setBrainError(undefined);
    setIsCompleted(false);

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const eventData = JSON.parse(event.data) as BrainEvent;
        const machine = machineRef.current;

        // Feed event to state machine - it handles all the state tracking
        sendEvent(machine, eventData);

        // Update React state from machine context to trigger re-render
        // Deep copy brainStack to ensure React detects the change
        // Note: Only update if brainStack has entries - preserve last known state for completed brains
        const currentStack = machine.context.brainStack;
        if (currentStack.length > 0) {
          setBrainStack(currentStack.map(entry => ({
            ...entry,
            steps: [...entry.steps],
          })));
        }

        // Check for completion (outer brain)
        if (machine.context.isComplete) {
          setIsCompleted(true);
        }

        // Check for error (capture the error event for display)
        if (eventData.type === BRAIN_EVENTS.ERROR) {
          const errorEvent = eventData as BrainErrorEvent;
          // Only show error for the main brain (isTopLevel check)
          if (machine.context.brainRunId === errorEvent.brainRunId) {
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

  // Main brain is the first entry in the stack (outer brain)
  const mainBrain = brainStack.length > 0 ? brainStack[0] : null;

  return (
    <Box flexDirection="column">
      {!isConnected && brainStack.length === 0 ? (
        <Text>Connecting to watch service...</Text>
      ) : !mainBrain ? (
        <Text>Waiting for brain to start...</Text>
      ) : (
        <>
          <BrainSection brain={mainBrain} brainStack={brainStack} />

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
