import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete, useApiGet } from '../hooks/useApi.js';
import { useConfirm } from '../hooks/useConfirm.js';

interface UsersDeleteProps {
  userName: string;
  force: boolean;
}

interface User {
  name: string;
  createdAt: number;
}

export const UsersDelete = ({ userName, force }: UsersDeleteProps) => {
  const {
    data: user,
    loading: loadingUser,
    error: getUserError,
  } = useApiGet<User>(`/users/${userName}`);
  const {
    loading: deleting,
    error: deleteError,
    execute,
  } = useApiDelete('user');
  const [deleted, setDeleted] = useState(false);
  const [deletionStarted, setDeletionStarted] = useState(false);

  const { confirmed } = useConfirm({
    mode: 'y/n',
    force,
    acting: deleting || deleted,
  });

  const handleDelete = useCallback(async () => {
    if (deletionStarted) return;
    setDeletionStarted(true);
    try {
      await execute(`/users/${userName}`);
      setDeleted(true);
    } catch {
      // Error is handled by the hook
    }
  }, [execute, userName, deletionStarted]);

  useEffect(() => {
    if (confirmed && user && !deleted && !deletionStarted) {
      handleDelete();
    }
  }, [confirmed, user, deleted, deletionStarted, handleDelete]);

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
        <Text color="red">User not found: {userName}</Text>
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
