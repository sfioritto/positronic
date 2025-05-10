import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { EventSource } from 'eventsource';
import type { WorkflowEvent, StepStatusEvent, WorkflowStartEvent, WorkflowErrorEvent } from '@positronic/core';
import { WORKFLOW_EVENTS } from '@positronic/core';
import type { SerializedStep } from '@positronic/core';
import { STATUS } from '@positronic/core';

// Recreate SerializedStepStatus based on the imported SerializedStep
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

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

interface WatchStatusProps {
  steps: SerializedStepStatus[];
  workflowTitle?: string;
  runId?: string;
}

export const WatchStatus = ({ steps, workflowTitle, runId }: WatchStatusProps) => {
  if (!steps || steps.length === 0) {
    return <Text>Waiting for workflow steps...</Text>;
  }

  return (
    <Box flexDirection="column">
      {workflowTitle && <Text bold>Workflow: {workflowTitle} Run ID: {runId}</Text>}
      <Box marginTop={1} marginBottom={1}>
        <Text bold>Steps:</Text>
      </Box>
      {steps.map((step) => (
        <Box key={step.id} marginLeft={1} marginBottom={1} flexDirection="row">
          <Box>
            <Text color={
              step.status === STATUS.COMPLETE ? 'green' :
              step.status === STATUS.ERROR ? 'red' :
              step.status === STATUS.RUNNING ? 'white' :
              step.status === STATUS.PENDING ? 'gray' :
              'yellow'
            }>
              {getStatusIndicator(step.status)} {step.title}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

interface WatchProps {
  runId: string;
  port: string;
}

export const Watch = ({ runId, port }: WatchProps) => {
  const [steps, setSteps] = useState<SerializedStepStatus[]>([]);
  const [workflowTitle, setWorkflowTitle] = useState<string | undefined>(undefined);
  const [workflowError, setWorkflowError] = useState<WorkflowErrorEvent | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  useEffect(() => {
    const baseUrl = `http://localhost:${port}`;
    const url = `${baseUrl}/brains/runs/${runId}/watch`;
    const es = new EventSource(url);

    setIsConnected(false);
    setError(null);

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const eventData = JSON.parse(event.data) as WorkflowEvent;
        if (eventData.type === WORKFLOW_EVENTS.STEP_STATUS) {
          setSteps((eventData as StepStatusEvent).steps);
        }

        if (
          eventData.type === WORKFLOW_EVENTS.START ||
          eventData.type === WORKFLOW_EVENTS.RESTART
        ) {
          setWorkflowTitle((eventData as WorkflowStartEvent).workflowTitle);
          setIsCompleted(false);
        }

        if (eventData.type === WORKFLOW_EVENTS.COMPLETE || eventData.type === WORKFLOW_EVENTS.ERROR) {
          setIsCompleted(true);
        }

        if (eventData.type === WORKFLOW_EVENTS.ERROR) {
          setWorkflowError(eventData);
        }
      } catch (e: any) {
        setError(new Error(`Error parsing event data: ${e.message}`));
      }
    };

    es.onerror = (err) => {
      // EventSource does not provide detailed error objects here, often just a generic Event
      setError(new Error(`Connection to ${url} failed. Ensure the server is running and accessible.`));
      setIsConnected(false);
      es.close();
    };

    // Cleanup function to close EventSource when component unmounts or runId/port changes
    return () => {
      es.close();
    };
  }, [runId, port]);

  if (!isConnected && steps.length === 0) {
    return <Text>Connecting to watch service...</Text>;
  }

  return (
    <Box flexDirection="column">
      <WatchStatus steps={steps} workflowTitle={workflowTitle} runId={runId} />
      {isCompleted && !error && !workflowError && (
        <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
            <Text color="green">Workflow completed.</Text>
        </Box>
      )}
       {error && (
        <Box borderStyle="round" borderColor="red" padding={1}>
          <Text color="red">{error.message}</Text>
          <Text color="red">{error.stack}</Text>
        </Box>
      )}
      {workflowError && (
        <Box borderStyle="round" borderColor="red" padding={1}>
          <Text color="red">{workflowError.error.name}</Text>
          <Text color="red">{workflowError.error.message}</Text>
          <Text color="red">{workflowError.error.stack}</Text>
        </Box>
      )}
    </Box>
  );
};