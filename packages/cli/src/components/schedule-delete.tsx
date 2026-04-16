import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete } from '../hooks/useApi.js';
import { useConfirm } from '../hooks/useConfirm.js';

interface ScheduleDeleteProps {
  scheduleId: string;
  force: boolean;
}

export const ScheduleDelete = ({ scheduleId, force }: ScheduleDeleteProps) => {
  const [deleted, setDeleted] = useState(false);
  const isDeleting = useRef(false);

  const { execute: deleteSchedule, loading, error } = useApiDelete('schedule');
  const { confirmed, input } = useConfirm({ mode: 'type-yes', force });

  useEffect(() => {
    if (confirmed && !deleted && !isDeleting.current) {
      isDeleting.current = true;
      deleteSchedule(`/brains/schedules/${scheduleId}`)
        .then(() => {
          setDeleted(true);
        })
        .catch(() => {
          // Error is already handled by useApiDelete
        })
        .finally(() => {
          isDeleting.current = false;
        });
    }
  }, [confirmed, deleted, scheduleId]);

  if (error) {
    // Check if it's a 404 error
    if (error.details?.includes('404')) {
      return (
        <Box flexDirection="column">
          <Text color="red">❌ Schedule not found</Text>
          <Box marginTop={1} paddingLeft={2}>
            <Text>No schedule found with ID: {scheduleId}</Text>
          </Box>
        </Box>
      );
    }
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>🗑️ Deleting schedule...</Text>
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Schedule deleted successfully!</Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>Schedule ID: {scheduleId}</Text>
        </Box>
      </Box>
    );
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">
          ⚠️ Warning: This will permanently delete the schedule
        </Text>
        <Box
          marginTop={1}
          marginBottom={1}
          paddingLeft={2}
          flexDirection="column"
        >
          <Text>Schedule ID: {scheduleId}</Text>
          <Text dimColor>
            All future runs for this schedule will be cancelled.
          </Text>
        </Box>
        <Text>Type "yes" to confirm deletion: {input}</Text>
      </Box>
    );
  }

  return null;
};
