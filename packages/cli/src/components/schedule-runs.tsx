import React from 'react';
import { Text, Box } from 'ink';

interface ScheduleRunsProps {
  scheduleId?: string;
  limit: number;
  status?: 'triggered' | 'failed' | 'complete';
}

export const ScheduleRuns = ({ scheduleId, limit, status }: ScheduleRunsProps) => {
  return (
    <Box flexDirection="column">
      <Text bold>Schedule Runs</Text>
      <Text color="yellow">⚠️  This command is not yet implemented.</Text>
      <Text dimColor>Coming soon: List scheduled run history</Text>
      {scheduleId && (
        <Box marginTop={1}>
          <Text dimColor>Schedule ID: {scheduleId}</Text>
        </Box>
      )}
      {status && (
        <Box>
          <Text dimColor>Filter status: {status}</Text>
        </Box>
      )}
      <Box>
        <Text dimColor>Limit: {limit}</Text>
      </Box>
    </Box>
  );
};