import React from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiGet } from '../hooks/useApi.js';
import { padRight, truncate, formatDate } from '../lib/format.js';

interface User {
  name: string;
  createdAt: number;
}

interface UsersResponse {
  users: User[];
  count: number;
}

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
    name: { header: 'Name', width: 30 },
    created: { header: 'Created', width: 20 },
  };

  const totalWidth =
    Object.values(columns).reduce((sum, col) => sum + col.width + 2, 0) - 2;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <Text bold>
        Found {data.count} user{data.count === 1 ? '' : 's'}:
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">
            {padRight(columns.name.header, columns.name.width)}
          </Text>
          <Text> </Text>
          <Text bold color="cyan">
            {padRight(columns.created.header, columns.created.width)}
          </Text>
        </Box>

        <Box>
          <Text dimColor>{'─'.repeat(totalWidth)}</Text>
        </Box>

        {sortedUsers.map((user) => (
          <Box key={user.name}>
            <Text>
              {padRight(
                truncate(user.name, columns.name.width),
                columns.name.width
              )}
            </Text>
            <Text> </Text>
            <Text dimColor>
              {padRight(formatDate(user.createdAt), columns.created.width)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
