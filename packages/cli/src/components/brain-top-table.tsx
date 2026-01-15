import React from 'react';
import { Text, Box } from 'ink';
import { STATUS } from '@positronic/core';

interface RunningBrain {
  brainRunId: string;
  brainTitle: string;
  brainDescription?: string;
  type: string;
  status: string;
  options?: any;
  error?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface BrainTopTableProps {
  runningBrains: RunningBrain[];
  selectedIndex?: number;
  interactive?: boolean;
  brainFilter?: string;
  footer?: string;
}

// Helper to format relative time
const formatRelativeTime = (timestamp: number) => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hr ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
};

// Helper to format live duration
const formatDuration = (startedAt: number) => {
  const durationMs = Date.now() - startedAt;
  const totalSeconds = Math.floor(durationMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

// Helper to get status color
const getStatusColor = (status: string) => {
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

// Helper to pad text to column width
const padRight = (text: string, width: number) => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

// Helper to truncate text
const truncate = (text: string, maxWidth: number) => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

// Column definitions
const columns = {
  brain: { header: 'Brain', width: 25 },
  runId: { header: 'Run ID', width: 36 },
  status: { header: 'Status', width: 10 },
  started: { header: 'Started', width: 12 },
  duration: { header: 'Duration', width: 10 },
};

export const BrainTopTable = ({
  runningBrains,
  selectedIndex,
  interactive = false,
  brainFilter,
  footer = 'Updates automatically. Press Ctrl+C to exit.',
}: BrainTopTableProps) => {
  // Filter brains client-side
  const filteredBrains = brainFilter
    ? runningBrains.filter((b) =>
        b.brainTitle.toLowerCase().includes(brainFilter.toLowerCase())
      )
    : runningBrains;

  if (filteredBrains.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          No running brains{brainFilter ? ` matching "${brainFilter}"` : ''}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Run a brain with "px run {'<brain-name>'}" to see it here
          </Text>
        </Box>
      </Box>
    );
  }

  // Selection indicator width (for interactive mode)
  const selectorWidth = interactive ? 2 : 0;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Running brains ({filteredBrains.length})
        {brainFilter ? ` matching "${brainFilter}"` : ''}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          {interactive && <Text>{'  '}</Text>}
          <Text bold color="cyan">
            {padRight(columns.brain.header, columns.brain.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.runId.header, columns.runId.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.status.header, columns.status.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.started.header, columns.started.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.duration.header, columns.duration.width)}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(97 + selectorWidth)}</Text>
        </Box>

        {/* Data rows */}
        {filteredBrains.map((brain, index) => {
          const duration = brain.startedAt
            ? formatDuration(brain.startedAt)
            : 'N/A';
          const started = brain.startedAt
            ? formatRelativeTime(brain.startedAt)
            : formatRelativeTime(brain.createdAt);
          const isSelected = interactive && index === selectedIndex;

          return (
            <Box key={brain.brainRunId}>
              {interactive && (
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
              )}
              <Text color={isSelected ? 'cyan' : undefined}>
                {padRight(
                  truncate(brain.brainTitle, columns.brain.width),
                  columns.brain.width
                )}
              </Text>
              <Text> </Text>
              <Text dimColor={!isSelected} color={isSelected ? 'cyan' : undefined}>
                {padRight(brain.brainRunId, columns.runId.width)}
              </Text>
              <Text> </Text>
              <Text color={isSelected ? 'cyan' : getStatusColor(brain.status)}>
                {padRight(brain.status, columns.status.width)}
              </Text>
              <Text> </Text>
              <Text dimColor={!isSelected} color={isSelected ? 'cyan' : undefined}>
                {padRight(started, columns.started.width)}
              </Text>
              <Text> </Text>
              <Text color={isSelected ? 'cyan' : undefined}>
                {padRight(duration, columns.duration.width)}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>{footer}</Text>
      </Box>
    </Box>
  );
};

// Re-export the RunningBrain type for consumers
export type { RunningBrain };
