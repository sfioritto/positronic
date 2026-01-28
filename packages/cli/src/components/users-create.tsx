import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { apiClient } from '../commands/helpers.js';

interface UsersCreateProps {
  name: string;
}

interface User {
  id: string;
  name: string;
  createdAt: number;
}

export const UsersCreate = ({ name }: UsersCreateProps) => {
  const [data, setData] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; message: string; details?: string } | null>(null);

  useEffect(() => {
    const createUser = async () => {
      try {
        const response = await apiClient.fetch('/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        });

        if (response.status === 201) {
          const result = (await response.json()) as User;
          setData(result);
        } else {
          const errorText = await response.text();
          setError({
            title: 'Server Error',
            message: `Error creating user: ${response.status} ${response.statusText}`,
            details: `Server response: ${errorText}`,
          });
        }
      } catch (err: any) {
        setError({
          title: 'Connection Error',
          message: 'Error connecting to the local development server.',
          details: err.message,
        });
      } finally {
        setLoading(false);
      }
    };

    createUser();
  }, [name]);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Creating user "{name}"...</Text>
      </Box>
    );
  }

  if (data) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <Text color="green">User created successfully!</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>Name:</Text> {data.name}
          </Text>
          <Text>
            <Text bold>ID:</Text> {data.id}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Add a key with: px users {data.id} keys add ~/.ssh/id_rsa.pub
          </Text>
        </Box>
      </Box>
    );
  }

  return null;
};
