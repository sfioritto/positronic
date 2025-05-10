import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { EventSource } from 'eventsource';
import type { WorkflowEvent, StepStatusEvent, WorkflowStartEvent, WorkflowErrorEvent } from '@positronic/core';
import { WORKFLOW_EVENTS } from '@positronic/core';
import type { SerializedStep } from '@positronic/core';
import { STATUS } from '@positronic/core';

// Recreate SerializedStepStatus based on the imported SerializedStep
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

interface WorkflowStepStatusViewProps {
  steps: SerializedStepStatus[];
  workflowTitle?: string;
}

const getStatusIndicator = (status: SerializedStepStatus['status']) => {
  switch (status) {
    case STATUS.COMPLETE:
      return <Text color="green">[✔]</Text>;
    case STATUS.ERROR:
      return <Text color="red">[✖]</Text>;
    case STATUS.RUNNING:
      return <Text color="blue">[▶]</Text>;
    case STATUS.PENDING:
      return <Text color="gray">[ ]</Text>;
    default:
      // Handle any unknown status gracefully
      return <Text color="yellow">[?]</Text>;
  }
};

export const WorkflowStepStatusView: React.FC<WorkflowStepStatusViewProps> = ({ steps, workflowTitle }) => {
  if (!steps || steps.length === 0) {
    return <Text>Waiting for workflow steps...</Text>;
  }

  return (
    <Box flexDirection="column">
      {workflowTitle && <Text bold>Workflow: {workflowTitle}</Text>}
      <Box marginTop={1}>
        <Text bold>Steps:</Text>
      </Box>
      {steps.map((step) => (
        <Box key={step.id} marginLeft={1} flexDirection="row">
          <Box width={3}>{getStatusIndicator(step.status)}</Box>
          <Text>{step.title}</Text>
        </Box>
      ))}
    </Box>
  );
};

interface BrainWatchDisplayProps {
  runId: string;
  port: string;
}

export const Watch: React.FC<BrainWatchDisplayProps> = ({ runId, port }) => {
  const [steps, setSteps] = useState<SerializedStepStatus[]>([]);
  const [workflowTitle, setWorkflowTitle] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
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
        if (eventData.type === WORKFLOW_EVENTS.START || eventData.type === WORKFLOW_EVENTS.RESTART) {
          setWorkflowTitle((eventData as WorkflowStartEvent).workflowTitle);
          setSteps([]); // Reset steps on new workflow start/restart
          setIsCompleted(false);
        }
        if (eventData.type === WORKFLOW_EVENTS.COMPLETE) {
          setIsCompleted(true);
          // Potentially close the event source if desired
          // es.close();
        }
        if (eventData.type === WORKFLOW_EVENTS.ERROR) {
          const errorPayload = (eventData as WorkflowErrorEvent).error;
          setError(`Workflow Error: ${errorPayload.name} - ${errorPayload.message}`);
          setIsCompleted(true); // Consider a workflow with an error as 'completed' for display purposes
          // es.close();
        }
      } catch (e: any) {
        console.error('Error parsing event data:', e);
        setError(`Error parsing event data: ${e.message}`);
      }
    };

    es.onerror = (err) => {
      // EventSource does not provide detailed error objects here, often just a generic Event
      console.error(`EventSource failed for URL: ${url}`, err);
      setError(`Connection to ${url} failed. Ensure the server is running and accessible.`);
      setIsConnected(false);
      es.close();
    };

    // Cleanup function to close EventSource when component unmounts or runId/port changes
    return () => {
      es.close();
    };
  }, [runId, port]);

  if (error) {
    return (
      <Box borderStyle="round" borderColor="red" padding={1}>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!isConnected && steps.length === 0) {
    return <Text>Connecting to watch service...</Text>;
  }

  return (
    <Box flexDirection="column">
      <WorkflowStepStatusView steps={steps} workflowTitle={workflowTitle} />
      {isCompleted && !error && (
        <Box marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
            <Text color="green">Workflow completed.</Text>
        </Box>
      )}
       {isCompleted && error && (
        <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
            <Text color="red">Workflow finished with errors.</Text>
        </Box>
      )}
    </Box>
  );
};