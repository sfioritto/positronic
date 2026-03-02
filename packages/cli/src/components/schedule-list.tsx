import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface ScheduleListProps {
  brainFilter?: string;
}

interface Schedule {
  id: string;
  brainTitle: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
}

interface SchedulesResponse {
  schedules: Schedule[];
  count: number;
}

// Helper to format dates consistently
const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

// Helper to format relative time
const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    return '(overdue)';
  } else if (diffMins < 1) {
    return '< 1 min';
  } else if (diffMins < 60) {
    return `${diffMins} min`;
  } else if (diffHours < 24) {
    return `${diffHours} hr`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  }
};

// Helper to truncate text to fit column width
const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

// Helper to pad text to column width
const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

export const ScheduleList = ({ brainFilter }: ScheduleListProps) => {
  const { data, loading, error } = useApiGet<SchedulesResponse>('/brains/schedules');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>📋 Loading schedules...</Text>
      </Box>
    );
  }

  if (!data || data.schedules.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No schedules found.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Create a schedule with "px schedule create &lt;brain-name&gt; &lt;cron-expression&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Filter schedules if brain filter is provided
  const filteredSchedules = brainFilter
    ? data.schedules.filter(s => s.brainTitle === brainFilter)
    : data.schedules;

  if (brainFilter && filteredSchedules.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No schedules found for brain: {brainFilter}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Create a schedule with "px schedule create {brainFilter} &lt;cron-expression&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Sort schedules by creation date (newest first)
  const sortedSchedules = [...filteredSchedules].sort((a, b) => b.createdAt - a.createdAt);

  // Define column widths
  const columns = {
    brainTitle: { header: 'Brain Title', width: 20 },
    schedule: { header: 'Schedule', width: 15 },
    status: { header: 'Status', width: 10 },
    timezone: { header: 'Timezone', width: 18 },
    nextRun: { header: 'Next Run', width: 12 },
    created: { header: 'Created', width: 20 },
    id: { header: 'ID', width: 36 },
  };

  // Calculate total width for separator
  const totalWidth = Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        {brainFilter
          ? `Found ${filteredSchedules.length} schedule${filteredSchedules.length === 1 ? '' : 's'} for brain "${brainFilter}"`
          : `Found ${data.count} schedule${data.count === 1 ? '' : 's'}`
        }:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">{padRight(columns.brainTitle.header, columns.brainTitle.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.schedule.header, columns.schedule.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.status.header, columns.status.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.timezone.header, columns.timezone.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.nextRun.header, columns.nextRun.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.created.header, columns.created.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.id.header, columns.id.width)}</Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedSchedules.map((schedule) => {
          const nextRunDate = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
          const createdDate = new Date(schedule.createdAt);
          const isOverdue = nextRunDate && nextRunDate.getTime() < Date.now();

          return (
            <Box key={schedule.id}>
              <Text>{padRight(truncate(schedule.brainTitle, columns.brainTitle.width), columns.brainTitle.width)}</Text>
              <Text>  </Text>
              <Text>{padRight(truncate(schedule.cronExpression, columns.schedule.width), columns.schedule.width)}</Text>
              <Text>  </Text>
              <Text color={schedule.enabled ? 'green' : 'red'}>
                {padRight(schedule.enabled ? 'Enabled' : 'Disabled', columns.status.width)}
              </Text>
              <Text>  </Text>
              <Text dimColor>{padRight(truncate(schedule.timezone || 'UTC', columns.timezone.width), columns.timezone.width)}</Text>
              <Text>  </Text>
              <Text color={isOverdue ? 'red' : undefined}>
                {padRight(
                  nextRunDate ? formatRelativeTime(nextRunDate) : 'N/A',
                  columns.nextRun.width
                )}
              </Text>
              <Text>  </Text>
              <Text dimColor>{padRight(truncate(formatDate(schedule.createdAt), columns.created.width), columns.created.width)}</Text>
              <Text>  </Text>
              <Text dimColor>{padRight(schedule.id, columns.id.width)}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};