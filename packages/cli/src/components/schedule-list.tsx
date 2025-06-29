import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface ScheduleListProps {
  brainFilter?: string;
}

interface Schedule {
  id: string;
  brainName: string;
  cronExpression: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
}

interface SchedulesResponse {
  schedules: Schedule[];
  count: number;
}

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
    ? data.schedules.filter(s => s.brainName === brainFilter)
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

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        {brainFilter
          ? `Found ${filteredSchedules.length} schedule${filteredSchedules.length === 1 ? '' : 's'} for brain "${brainFilter}"`
          : `Found ${data.count} schedule${data.count === 1 ? '' : 's'}`
        }:
      </Text>

      <Box marginTop={1} flexDirection="column">
        {sortedSchedules.map((schedule, index) => (
          <Box key={schedule.id} marginBottom={index < sortedSchedules.length - 1 ? 1 : 0}>
            <ScheduleItem schedule={schedule} />
          </Box>
        ))}
      </Box>
    </Box>
  );
};

interface ScheduleItemProps {
  schedule: Schedule;
}

const ScheduleItem = ({ schedule }: ScheduleItemProps) => {
  const createdDate = new Date(schedule.createdAt);
  const nextRunDate = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;

  // Helper to format relative time
  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs < 0) {
      return 'overdue';
    } else if (diffMins < 1) {
      return 'less than a minute';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins === 1 ? '' : 's'}`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;
    } else {
      return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box>
        <Text bold color="cyan">{schedule.brainName}</Text>
        <Text dimColor> • </Text>
        <Text color={schedule.enabled ? 'green' : 'red'}>
          {schedule.enabled ? 'Enabled' : 'Disabled'}
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text dimColor>Name: </Text>
          {schedule.brainName}
        </Text>
        <Text>
          <Text dimColor>ID: </Text>
          {schedule.id}
        </Text>
        <Text>
          <Text dimColor>Schedule: </Text>
          {schedule.cronExpression}
        </Text>
        <Text>
          <Text dimColor>Created: </Text>
          {createdDate.toLocaleString()}
        </Text>
        {nextRunDate && (
          <Text>
            <Text dimColor>Next run: </Text>
            {nextRunDate.toLocaleString()}
            <Text dimColor> (in {formatRelativeTime(nextRunDate)})</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
};