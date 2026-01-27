import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface UsersKeysListProps {
  userId: string;
}

interface UserKey {
  fingerprint: string;
  userId: string;
  label: string;
  addedAt: number;
}

interface KeysResponse {
  keys: UserKey[];
  count: number;
}

interface User {
  id: string;
  name: string;
  createdAt: number;
}

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.substring(0, maxWidth - 3) + '...';
};

const padRight = (text: string, width: number): string => {
  return text + ' '.repeat(Math.max(0, width - text.length));
};

export const UsersKeysList = ({ userId }: UsersKeysListProps) => {
  const { data: user, loading: loadingUser, error: userError } = useApiGet<User>(`/users/${userId}`);
  const { data, loading, error } = useApiGet<KeysResponse>(`/users/${userId}/keys`);

  if (userError) {
    return <ErrorComponent error={userError} />;
  }

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loadingUser || loading) {
    return (
      <Box>
        <Text>Loading keys...</Text>
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

  if (!data || data.keys.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No keys found for user "{user.name}".</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Add a key with "px users {userId} keys add ~/.ssh/id_rsa.pub"
          </Text>
        </Box>
      </Box>
    );
  }

  const sortedKeys = [...data.keys].sort((a, b) => b.addedAt - a.addedAt);

  const columns = {
    fingerprint: { header: 'Fingerprint', width: 50 },
    label: { header: 'Label', width: 20 },
    added: { header: 'Added', width: 20 },
  };

  const totalWidth = Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Keys for user "{user.name}" ({data.count} key{data.count === 1 ? '' : 's'}):
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{padRight(columns.fingerprint.header, columns.fingerprint.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.label.header, columns.label.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.added.header, columns.added.width)}</Text>
        </Box>

        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {sortedKeys.map((key) => (
          <Box key={key.fingerprint}>
            <Text>{padRight(truncate(key.fingerprint, columns.fingerprint.width), columns.fingerprint.width)}</Text>
            <Text>  </Text>
            <Text>{padRight(truncate(key.label || '-', columns.label.width), columns.label.width)}</Text>
            <Text>  </Text>
            <Text dimColor>{padRight(formatDate(key.addedAt), columns.added.width)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
