import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { STATUS } from '@positronic/core';
import {
  padRight,
  truncate,
  formatDate,
  formatRelativeTime,
  formatDuration,
  getStatusColor,
} from '../lib/format.js';

interface BrainHistoryProps {
  brainName: string;
  limit: number;
}

interface BrainRun {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  type: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  options?: any;
  error?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface BrainHistoryResponse {
  runs: BrainRun[];
}

export const BrainHistory = ({ brainName, limit }: BrainHistoryProps) => {
  const url = `/brains/${encodeURIComponent(brainName)}/history?limit=${limit}`;
  const { data, loading, error } = useApiGet<BrainHistoryResponse>(url);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>🧠 Loading brain history...</Text>
      </Box>
    );
  }

  if (!data || data.runs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No run history found for brain: {brainName}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Run this brain with "px run {brainName}" to create history
          </Text>
        </Box>
      </Box>
    );
  }

  // Define column widths
  const columns = {
    runId: { header: 'Run ID', width: 38 },
    status: { header: 'Status', width: 10 },
    type: { header: 'Type', width: 10 },
    when: { header: 'When', width: 12 },
    duration: { header: 'Duration', width: 10 },
    startedAt: { header: 'Started At', width: 20 },
  };

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Recent runs for brain "{brainName}" ({data.runs.length} shown):
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">
            {padRight(columns.runId.header, columns.runId.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.status.header, columns.status.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.type.header, columns.type.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.when.header, columns.when.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.duration.header, columns.duration.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.startedAt.header, columns.startedAt.width)}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(112)}</Text>
        </Box>

        {/* Data rows */}
        {data.runs.map((run) => {
          const duration =
            run.startedAt && run.completedAt
              ? formatDuration(run.startedAt, run.completedAt)
              : run.status === STATUS.RUNNING
              ? 'Running...'
              : 'N/A';

          return (
            <Box key={run.brainRunId}>
              <Text>
                {padRight(
                  truncate(run.brainRunId, columns.runId.width),
                  columns.runId.width
                )}
              </Text>
              <Text> </Text>
              <Text color={getStatusColor(run.status)}>
                {padRight(run.status, columns.status.width)}
              </Text>
              <Text> </Text>
              <Text>{padRight(run.type || 'N/A', columns.type.width)}</Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(
                  formatRelativeTime(run.createdAt),
                  columns.when.width
                )}
              </Text>
              <Text> </Text>
              <Text>{padRight(duration, columns.duration.width)}</Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(
                  run.startedAt ? formatDate(run.startedAt) : 'N/A',
                  columns.startedAt.width
                )}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
