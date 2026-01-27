import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete, useApiGet } from '../hooks/useApi.js';

interface UsersKeysRemoveProps {
  userId: string;
  fingerprint: string;
  force: boolean;
}

interface User {
  id: string;
  name: string;
  createdAt: number;
}

export const UsersKeysRemove = ({ userId, fingerprint, force }: UsersKeysRemoveProps) => {
  const { exit } = useApp();
  const { data: user, loading: loadingUser, error: userError } = useApiGet<User>(`/users/${userId}`);
  const { loading: deleting, error: deleteError, execute } = useApiDelete('key');
  const [confirmed, setConfirmed] = useState(force);
  const [deleted, setDeleted] = useState(false);
  const [deletionStarted, setDeletionStarted] = useState(false);

  const handleDelete = useCallback(async () => {
    if (deletionStarted) return;
    setDeletionStarted(true);
    try {
      await execute(`/users/${userId}/keys/${encodeURIComponent(fingerprint)}`);
      setDeleted(true);
    } catch {
      // Error is handled by the hook
    }
  }, [execute, userId, fingerprint, deletionStarted]);

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

  if (userError) {
    return <ErrorComponent error={userError} />;
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
        <Text color="green">Key removed successfully.</Text>
        <Box marginTop={1}>
          <Text dimColor>Fingerprint: {fingerprint}</Text>
        </Box>
      </Box>
    );
  }

  if (deleting) {
    return (
      <Box>
        <Text>Removing key...</Text>
      </Box>
    );
  }

  if (!confirmed) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text>
          Are you sure you want to remove this key from user <Text bold>"{user.name}"</Text>?
        </Text>
        <Text dimColor>Fingerprint: {fingerprint}</Text>
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
