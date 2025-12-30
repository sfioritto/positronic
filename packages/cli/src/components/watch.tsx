import React, { useState, useEffect, useRef } from 'react';
import { Text, Box } from 'ink';
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
}

const getStatusIndicator = (status: SerializedStepStatus['status']) => {
  switch (status) {
    case STATUS.COMPLETE:
      return <Text color="green">&#10004;</Text>
    case STATUS.ERROR:
      return <Text color="red">&bull;</Text>
    case STATUS.RUNNING:
      return <Text color="white">&bull;</Text>
    case STATUS.PENDING:
      return <Text>&bull;</Text>
    default:
      return <Text>❓</Text>
  }
};

// Recursive component for rendering brain steps with nested inner brains
interface BrainStepsViewProps {
  brainRunId: string;
  brains: Map<string, BrainState>;
  depth?: number;
}

const BrainStepsView = ({ brainRunId, brains, depth = 0 }: BrainStepsViewProps) => {
  const brain = brains.get(brainRunId);
  if (!brain) return null;

  return (
    <Box flexDirection="column" marginLeft={depth > 0 ? 2 : 0}>
      {depth > 0 && (
        <Text dimColor>└─ Inner Brain: {brain.brainTitle}</Text>
      )}
      {brain.steps.map((step) => {
        // Find any inner brain associated with this step
        const innerBrain = Array.from(brains.values()).find(
          (b) => b.parentStepId === step.id
        );

        return (
          <Box key={step.id} flexDirection="column">
            <Box marginLeft={1} marginBottom={innerBrain ? 0 : 1} flexDirection="row">
              <Text
                color={
                  step.status === STATUS.COMPLETE
                    ? 'green'
                    : step.status === STATUS.ERROR
                      ? 'red'
                      : step.status === STATUS.RUNNING
                        ? 'white'
                        : step.status === STATUS.PENDING
                          ? 'gray'
                          : 'yellow'
                }
              >
                {getStatusIndicator(step.status)} {step.title}
              </Text>
            </Box>
            {innerBrain && (
              <Box marginBottom={1}>
                <BrainStepsView brainRunId={innerBrain.brainRunId} brains={brains} depth={depth + 1} />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

interface WatchStatusProps {
  brains: Map<string, BrainState>;
  mainBrainRunId: string | null;
}

const WatchStatus = ({ brains, mainBrainRunId }: WatchStatusProps) => {
  const mainBrain = mainBrainRunId ? brains.get(mainBrainRunId) : null;

  // Maintain consistent Box wrapper for proper Ink terminal clearing
  return (
    <Box flexDirection="column">
      {!mainBrain || mainBrain.steps.length === 0 ? (
        <Text>Waiting for brain steps...</Text>
      ) : (
        <>
          <Text bold>Brain: {mainBrain.brainTitle}</Text>
          <Box marginTop={1} marginBottom={1}>
            <Text bold>Steps:</Text>
          </Box>
          <BrainStepsView brainRunId={mainBrainRunId!} brains={brains} />
        </>
      )}
    </Box>
  );
};

interface WatchProps {
  runId: string;
}

export const Watch = ({ runId }: WatchProps) => {
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

        // Only mark complete when the main brain completes, not inner brains
        if (eventData.type === BRAIN_EVENTS.COMPLETE || eventData.type === BRAIN_EVENTS.ERROR) {
          const completeEvent = eventData as BrainCompleteEvent | BrainErrorEvent;
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

    es.onerror = (err) => {
      // EventSource does not provide detailed error objects here, often just a generic Event
      const errorMessage = isApiLocalDevMode()
        ? `Connection to ${url} failed. Ensure the local development server is running ('positronic server' or 'px s').`
        : `Connection to ${url} failed. Please check your network connection and verify the project URL is correct.`;
      setError(new Error(errorMessage));
      setIsConnected(false);
      es.close();
    };

    // Cleanup function to close EventSource when component unmounts or runId changes
    return () => {
      es.close();
    };
  }, [runId]);

  // Maintain consistent Box wrapper to help Ink properly calculate
  // terminal clearing between renders (prevents appending instead of overwriting)
  return (
    <Box flexDirection="column">
      {!isConnected && brains.size === 0 ? (
        <Text>Connecting to watch service...</Text>
      ) : (
        <>
          <WatchStatus brains={brains} mainBrainRunId={mainBrainRunIdRef.current} />
          {isCompleted && !error && !brainError && (
            <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
              <Text color="green">Brain completed.</Text>
            </Box>
          )}
          {error && (
            <ErrorComponent error={{
              title: 'Connection Error',
              message: error.message,
              details: error.stack,
            }} />
          )}
          {brainError && (
            <ErrorComponent error={{
              title: brainError.error.name || 'Brain Error',
              message: brainError.error.message,
              details: brainError.error.stack,
            }} />
          )}
        </>
      )}
    </Box>
  );
};