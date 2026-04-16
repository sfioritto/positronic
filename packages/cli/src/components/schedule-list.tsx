import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';
import {
  padRight,
  truncate,
  formatDate,
  formatNextRunTime,
} from '../lib/format.js';

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
  runAsUserName: string;
}

interface SchedulesResponse {
  schedules: Schedule[];
  count: number;
}

export const ScheduleList = ({ brainFilter }: ScheduleListProps) => {
  const { data, loading, error } =
    useApiGet<SchedulesResponse>('/brains/schedules');

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
            Tip: Create a schedule with "px schedule create &lt;brain-name&gt;
            &lt;cron-expression&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Filter schedules if brain filter is provided
  const filteredSchedules = brainFilter
    ? data.schedules.filter((s) => s.brainTitle === brainFilter)
    : data.schedules;

  if (brainFilter && filteredSchedules.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No schedules found for brain: {brainFilter}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Create a schedule with "px schedule create {brainFilter}{' '}
            &lt;cron-expression&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  // Sort schedules by creation date (newest first)
  const sortedSchedules = [...filteredSchedules].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  // Define column widths
  const columns = {
    brainTitle: { header: 'Brain Title', width: 20 },
    schedule: { header: 'Schedule', width: 15 },
    status: { header: 'Status', width: 10 },
    runAs: { header: 'Run As', width: 14 },
    timezone: { header: 'Timezone', width: 18 },
    nextRun: { header: 'Next Run', width: 12 },
    created: { header: 'Created', width: 20 },
    id: { header: 'ID', width: 36 },
  };

  // Calculate total width for separator
  const totalWidth =
    Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        {brainFilter
          ? `Found ${filteredSchedules.length} schedule${
              filteredSchedules.length === 1 ? '' : 's'
            } for brain "${brainFilter}"`
          : `Found ${data.count} schedule${data.count === 1 ? '' : 's'}`}
        :
      </Text>

      <Box marginTop={1} flexDirection="column">
        {/* Header row */}
        <Box>
          <Text bold color="cyan">
            {padRight(columns.brainTitle.header, columns.brainTitle.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.schedule.header, columns.schedule.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.status.header, columns.status.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.runAs.header, columns.runAs.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.timezone.header, columns.timezone.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.nextRun.header, columns.nextRun.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.created.header, columns.created.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.id.header, columns.id.width)}
          </Text>
        </Box>

        {/* Separator */}
        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {/* Data rows */}
        {sortedSchedules.map((schedule) => {
          const nextRunDate = schedule.nextRunAt
            ? new Date(schedule.nextRunAt)
            : null;
          const createdDate = new Date(schedule.createdAt);
          const isOverdue = nextRunDate && nextRunDate.getTime() < Date.now();

          return (
            <Box key={schedule.id}>
              <Text>
                {padRight(
                  truncate(schedule.brainTitle, columns.brainTitle.width),
                  columns.brainTitle.width
                )}
              </Text>
              <Text> </Text>
              <Text>
                {padRight(
                  truncate(schedule.cronExpression, columns.schedule.width),
                  columns.schedule.width
                )}
              </Text>
              <Text> </Text>
              <Text color={schedule.enabled ? 'green' : 'red'}>
                {padRight(
                  schedule.enabled ? 'Enabled' : 'Disabled',
                  columns.status.width
                )}
              </Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(
                  truncate(schedule.runAsUserName, columns.runAs.width),
                  columns.runAs.width
                )}
              </Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(
                  truncate(schedule.timezone || 'UTC', columns.timezone.width),
                  columns.timezone.width
                )}
              </Text>
              <Text> </Text>
              <Text color={isOverdue ? 'red' : undefined}>
                {padRight(
                  nextRunDate ? formatNextRunTime(nextRunDate) : 'N/A',
                  columns.nextRun.width
                )}
              </Text>
              <Text> </Text>
              <Text dimColor>
                {padRight(
                  truncate(
                    formatDate(schedule.createdAt),
                    columns.created.width
                  ),
                  columns.created.width
                )}
              </Text>
              <Text> </Text>
              <Text dimColor>{padRight(schedule.id, columns.id.width)}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
