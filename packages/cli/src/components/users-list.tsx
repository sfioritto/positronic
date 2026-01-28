import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';

interface User {
  id: string;
  name: string;
  createdAt: number;
}

interface UsersResponse {
  users: User[];
  count: number;
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

export const UsersList = () => {
  const { data, loading, error } = useApiGet<UsersResponse>('/users');

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Loading users...</Text>
      </Box>
    );
  }

  if (!data || data.users.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No users found.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Tip: Create a user with "px users create &lt;name&gt;"
          </Text>
        </Box>
      </Box>
    );
  }

  const sortedUsers = [...data.users].sort((a, b) => b.createdAt - a.createdAt);

  const columns = {
    name: { header: 'Name', width: 20 },
    id: { header: 'ID', width: 36 },
    created: { header: 'Created', width: 20 },
  };

  const totalWidth = Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {data.count} user{data.count === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">{padRight(columns.name.header, columns.name.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.id.header, columns.id.width)}</Text>
          <Text>  </Text>
          <Text bold color="cyan">{padRight(columns.created.header, columns.created.width)}</Text>
        </Box>

        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {sortedUsers.map((user) => (
          <Box key={user.id}>
            <Text>{padRight(truncate(user.name, columns.name.width), columns.name.width)}</Text>
            <Text>  </Text>
            <Text dimColor>{padRight(user.id, columns.id.width)}</Text>
            <Text>  </Text>
            <Text dimColor>{padRight(formatDate(user.createdAt), columns.created.width)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
