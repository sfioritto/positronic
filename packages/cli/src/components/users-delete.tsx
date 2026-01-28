import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete, useApiGet } from '../hooks/useApi.js';

interface UsersDeleteProps {
  userId: string;
  force: boolean;
}

interface User {
  id: string;
  name: string;
  createdAt: number;
}

export const UsersDelete = ({ userId, force }: UsersDeleteProps) => {
  const { exit } = useApp();
  const { data: user, loading: loadingUser, error: getUserError } = useApiGet<User>(`/users/${userId}`);
  const { loading: deleting, error: deleteError, execute } = useApiDelete('user');
  const [confirmed, setConfirmed] = useState(force);
  const [deleted, setDeleted] = useState(false);
  const [deletionStarted, setDeletionStarted] = useState(false);

  const handleDelete = useCallback(async () => {
    if (deletionStarted) return;
    setDeletionStarted(true);
    try {
      await execute(`/users/${userId}`);
      setDeleted(true);
    } catch {
      // Error is handled by the hook
    }
  }, [execute, userId, deletionStarted]);

  useEffect(() => {
    if (confirmed && user && !deleted && !deletionStarted) {
      handleDelete();
    }
  }, [confirmed, user, deleted, deletionStarted, handleDelete]);

  useInput((input, key) => {
    if (!confirmed && !deleting && !deleted) {
      if (input.toLowerCase() === 'y') {
        setConfirmed(true);
      } else if (input.toLowerCase() === 'n' || key.escape) {
        exit();
      }
    }
  });

  if (getUserError) {
    return <ErrorComponent error={getUserError} />;
  }

  if (deleteError) {
    return <ErrorComponent error={deleteError} />;
  }

  if (loadingUser) {
    return (
      <Box>
        <Text>Loading user...</Text>
      </Box>
    );
  }

  if (!user) {
    return (
      <Box>
        <Text color="red">User not found: {userId}</Text>
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="green">User "{user.name}" deleted successfully.</Text>
      </Box>
    );
  }

  if (deleting) {
    return (
      <Box>
        <Text>Deleting user "{user.name}"...</Text>
      </Box>
    );
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text>
          Are you sure you want to delete user <Text bold>"{user.name}"</Text>?
        </Text>
        <Text dimColor>This will also remove all associated keys.</Text>
        <Box marginTop={1}>
          <Text>
            Press <Text bold>y</Text> to confirm, <Text bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  return null;
};
