import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';
import { padRight, formatDate, formatRelativeTime } from '../lib/format.js';

interface ScheduleRunsProps {
  scheduleId?: string;
  limit: number;
  status?: 'triggered' | 'failed' | 'complete';
}

interface ScheduledRun {
  id: string;
  scheduleId: string;
  status: 'triggered' | 'failed';
  ranAt: number;
  brainRunId?: string;
  error?: string;
}

interface ScheduleRunsResponse {
  runs: ScheduledRun[];
  count: number;
}

export const ScheduleRuns = ({
  scheduleId,
  limit,
  status,
}: ScheduleRunsProps) => {
  // Build query params
  const params = new URLSearchParams();
  if (scheduleId) params.set('scheduleId', scheduleId);
  params.set('limit', limit.toString());

  const queryString = params.toString();
  const url = `/brains/schedules/runs${queryString ? `?${queryString}` : ''}`;

  const { data, loading, error } = useApiGet<ScheduleRunsResponse>(url);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>📋 Loading scheduled runs...</Text>
      </Box>
    );
  }

  if (!data || data.runs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No scheduled runs found.</Text>
        {scheduleId && (
          <Box marginTop={1}>
            <Text dimColor>No runs found for schedule ID: {scheduleId}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Filter by status if provided (client-side filtering since API doesn't support it)
  const filteredRuns = status
    ? data.runs.filter((run) => run.status === status)
    : data.runs;

  if (status && filteredRuns.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No runs found with status: {status}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {filteredRuns.length} scheduled run
        {filteredRuns.length === 1 ? '' : 's'}
        {scheduleId && ` for schedule ${scheduleId}`}
        {status && ` with status ${status}`}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">
            {padRight('Run ID', 38)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight('Schedule ID', 38)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight('Status', 10)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight('Ran At', 20)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight('When', 12)}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(130)}</Text>
        </Box>

        {/* Data rows */}
        {filteredRuns.map((run) => (
          <Box key={run.id}>
            <Text>{padRight(run.id, 38)}</Text>
            <Text> </Text>
            <Text>{padRight(run.scheduleId, 38)}</Text>
            <Text> </Text>
            <Text color={run.status === 'triggered' ? 'green' : 'red'}>
              {padRight(run.status, 10)}
            </Text>
            <Text> </Text>
            <Text dimColor>{padRight(formatDate(run.ranAt), 20)}</Text>
            <Text> </Text>
            <Text dimColor>{padRight(formatRelativeTime(run.ranAt), 12)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
