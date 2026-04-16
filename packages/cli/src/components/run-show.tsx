import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { STATUS } from '@positronic/core';
import { formatDate, formatDuration, getStatusColor } from '../lib/format.js';
import { Field } from './field.js';

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

export const RunShow = ({ runId }: RunShowProps) => {
  const { data, loading, error } = useApiGet<BrainRun>(
    `/brains/runs/${encodeURIComponent(runId)}`
  );

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

  const duration =
    data.startedAt && data.completedAt
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
          <Box
            borderStyle="round"
            borderColor="red"
            flexDirection="column"
            paddingX={1}
          >
            <Text bold color="red">
              Error Details
            </Text>
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
                <Text bold dimColor>
                  Stack Trace:
                </Text>
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
