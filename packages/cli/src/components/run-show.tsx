import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { STATUS } from '@positronic/core';

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

interface BrainRun {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  type: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  options?: Record<string, any>;
  error?: SerializedError;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface RunShowProps {
  runId: string;
}

// Helper to format dates
const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

// Helper to format duration
const formatDuration = (startMs: number, endMs: number): string => {
  const durationMs = endMs - startMs;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
};

// Helper to get status color
const getStatusColor = (status: string): string => {
  switch (status) {
    case STATUS.COMPLETE:
      return 'green';
    case STATUS.ERROR:
      return 'red';
    case STATUS.RUNNING:
      return 'yellow';
    case STATUS.CANCELLED:
      return 'gray';
    default:
      return 'white';
  }
};

// Component to display a labeled field
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Box width={14}>
      <Text dimColor>{label}:</Text>
    </Box>
    <Box flexGrow={1}>
      {children}
    </Box>
  </Box>
);

export const RunShow = ({ runId }: RunShowProps) => {
  const { data, loading, error } = useApiGet<BrainRun>(`/brains/runs/${encodeURIComponent(runId)}`);

  if (loading) {
    return (
      <Box>
        <Text>Loading run details...</Text>
      </Box>
    );
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (!data) {
    return (
      <Box flexDirection="column">
        <Text color="red">Run '{runId}' not found</Text>
      </Box>
    );
  }

  const duration = data.startedAt && data.completedAt
    ? formatDuration(data.startedAt, data.completedAt)
    : data.status === STATUS.RUNNING
    ? 'Running...'
    : 'N/A';

  return (
    <Box flexDirection="column" gap={1}>
      {/* Header */}
      <Box flexDirection="column">
        <Field label="Run ID">
          <Text>{data.brainRunId}</Text>
        </Field>
        <Field label="Brain">
          <Text bold>{data.brainTitle}</Text>
        </Field>
        {data.brainDescription && (
          <Field label="Description">
            <Text dimColor>{data.brainDescription}</Text>
          </Field>
        )}
        <Field label="Status">
          <Text color={getStatusColor(data.status)} bold>
            {data.status}
          </Text>
        </Field>
        <Field label="Type">
          <Text>{data.type}</Text>
        </Field>
      </Box>

      {/* Timing */}
      <Box flexDirection="column">
        <Field label="Created">
          <Text>{formatDate(data.createdAt)}</Text>
        </Field>
        {data.startedAt && (
          <Field label="Started">
            <Text>{formatDate(data.startedAt)}</Text>
          </Field>
        )}
        {data.completedAt && (
          <Field label="Completed">
            <Text>{formatDate(data.completedAt)}</Text>
          </Field>
        )}
        <Field label="Duration">
          <Text>{duration}</Text>
        </Field>
      </Box>

      {/* Options if any */}
      {data.options && Object.keys(data.options).length > 0 && (
        <Box flexDirection="column">
          <Text bold>Options:</Text>
          <Box marginLeft={2} flexDirection="column">
            {Object.entries(data.options).map(([key, value]) => (
              <Text key={key}>
                <Text dimColor>{key}:</Text> {String(value)}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {/* Error details if status is error */}
      {data.status === STATUS.ERROR && data.error && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
            <Text bold color="red">Error Details</Text>
            <Box marginTop={1} flexDirection="column">
              <Field label="Type">
                <Text color="red">{data.error.name}</Text>
              </Field>
              <Field label="Message">
                <Text color="red">{data.error.message}</Text>
              </Field>
            </Box>
            {data.error.stack && (
              <Box marginTop={1} flexDirection="column">
                <Text bold dimColor>Stack Trace:</Text>
                <Box marginLeft={2}>
                  <Text dimColor>{data.error.stack}</Text>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Success message for completed runs */}
      {data.status === STATUS.COMPLETE && (
        <Box marginTop={1}>
          <Text color="green">Run completed successfully.</Text>
        </Box>
      )}

      {/* Cancelled message */}
      {data.status === STATUS.CANCELLED && (
        <Box marginTop={1}>
          <Text color="gray">Run was cancelled.</Text>
        </Box>
      )}
    </Box>
  );
};
