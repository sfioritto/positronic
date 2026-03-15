import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiPost } from '../hooks/useApi.js';

interface ScheduleCreateProps {
  identifier: string;
  cronExpression: string;
  options?: Record<string, string>;
  initialState?: Record<string, unknown>;
}

interface CreateScheduleResponse {
  id: string;
  brainTitle: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
}

export const ScheduleCreate = ({
  identifier,
  cronExpression,
  options,
  initialState,
}: ScheduleCreateProps) => {
  const [created, setCreated] = useState(false);
  const [schedule, setSchedule] = useState<CreateScheduleResponse | null>(null);

  const { execute, loading, error } = useApiPost<CreateScheduleResponse>(
    '/brains/schedules',
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  useEffect(() => {
    const createSchedule = async () => {
      try {
        const result = await execute({
          identifier,
          cronExpression,
          options,
          ...(initialState && { initialState }),
        });
        setSchedule(result);
        setCreated(true);
      } catch (err) {
        // Error is already handled by useApiPost
      }
    };

    createSchedule();
  }, []);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>⏰ Creating schedule...</Text>
      </Box>
    );
  }

  if (created && schedule) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Schedule created successfully!</Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold>Schedule ID:</Text> {schedule.id}
          </Text>
          <Text>
            <Text bold>Brain:</Text> {schedule.brainTitle}
          </Text>
          <Text>
            <Text bold>Cron Expression:</Text> {schedule.cronExpression}
          </Text>
          <Text>
            <Text bold>Timezone:</Text> {schedule.timezone}
          </Text>
          <Text>
            <Text bold>Status:</Text>{' '}
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </Text>
          {options && Object.keys(options).length > 0 && (
            <Text>
              <Text bold>Options:</Text>{' '}
              {Object.entries(options)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')}
            </Text>
          )}
          {initialState && Object.keys(initialState).length > 0 && (
            <Text>
              <Text bold>Initial State:</Text> {JSON.stringify(initialState)}
            </Text>
          )}
          {schedule.nextRunAt && (
            <Text>
              <Text bold>Next Run:</Text>{' '}
              {new Date(schedule.nextRunAt).toLocaleString('en-US', {
                timeZone: schedule.timezone,
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Tip: Use "px schedule -l" to view all schedules</Text>
        </Box>
      </Box>
    );
  }

  return null;
};
