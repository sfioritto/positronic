import React from 'react';
import { Text, Box } from 'ink';
import {
  padRight,
  truncate,
  formatRelativeTime,
  formatDuration,
  getStatusColor,
} from '../lib/format.js';

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
              <Text
                dimColor={!isSelected}
                color={isSelected ? 'cyan' : undefined}
              >
                {padRight(brain.brainRunId, columns.runId.width)}
              </Text>
              <Text> </Text>
              <Text color={isSelected ? 'cyan' : getStatusColor(brain.status)}>
                {padRight(brain.status, columns.status.width)}
              </Text>
              <Text> </Text>
              <Text
                dimColor={!isSelected}
                color={isSelected ? 'cyan' : undefined}
              >
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
