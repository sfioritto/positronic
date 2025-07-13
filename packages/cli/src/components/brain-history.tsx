import React from 'react';
import { Text, Box } from 'ink';
import { useApiGet } from '../hooks/useApi.js';
import { ErrorComponent } from './error.js';

interface BrainHistoryProps {
  brainName: string;
  limit: number;
}

interface BrainRun {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  type: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  options?: any;
  error?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface BrainHistoryResponse {
  runs: BrainRun[];
}

// Helper to format dates
const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

// Helper to format relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hr ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
};

// Helper to format duration
const formatDuration = (startMs: number, endMs: number): string => {
  const durationMs = endMs - startMs;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (seconds < 60) {
    return `${seconds}s`;
  } else {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
};

// Helper to get status color
const getStatusColor = (status: string): string => {
  switch (status) {
    case 'COMPLETE':
      return 'green';
    case 'ERROR':
      return 'red';
    case 'RUNNING':
      return 'yellow';
    default:
      return 'gray';
  }
};

// Helper to pad text to column width
const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

// Helper to truncate text
const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

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
          <Text bold color="cyan">{padRight(columns.runId.header, columns.runId.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.status.header, columns.status.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.type.header, columns.type.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.when.header, columns.when.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.duration.header, columns.duration.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.startedAt.header, columns.startedAt.width)}</Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(112)}</Text>
        </Box>

        {/* Data rows */}
        {data.runs.map((run) => {
          const duration = run.startedAt && run.completedAt 
            ? formatDuration(run.startedAt, run.completedAt)
            : run.status === 'RUNNING' ? 'Running...' : 'N/A';

          return (
            <Box key={run.brainRunId}>
              <Text>{padRight(truncate(run.brainRunId, columns.runId.width), columns.runId.width)}</Text>
              <Text>  </Text>
              <Text color={getStatusColor(run.status)}>
                {padRight(run.status, columns.status.width)}
              </Text>
              <Text>  </Text>
              <Text>{padRight(run.type || 'N/A', columns.type.width)}</Text>
              <Text>  </Text>
              <Text dimColor>{padRight(formatRelativeTime(run.createdAt), columns.when.width)}</Text>
              <Text>  </Text>
              <Text>{padRight(duration, columns.duration.width)}</Text>
              <Text>  </Text>
              <Text dimColor>{padRight(run.startedAt ? formatDate(run.startedAt) : 'N/A', columns.startedAt.width)}</Text>
            </Box>
          );
        })}

        {/* Show errors if any */}
        {data.runs.filter(r => r.status === 'ERROR' && r.error).length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="red">Errors:</Text>
            {data.runs.filter(r => r.status === 'ERROR' && r.error).map((run) => (
              <Box key={run.brainRunId} marginLeft={2}>
                <Text dimColor>{run.brainRunId}: </Text>
                <Text color="red">{typeof run.error === 'string' ? run.error : JSON.stringify(run.error)}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};