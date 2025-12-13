import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ErrorComponent } from './error.js';
import { useApiDelete } from '../hooks/useApi.js';

interface SecretDeleteProps {
  name: string;
}

export const SecretDelete = ({ name }: SecretDeleteProps) => {
  const [deleted, setDeleted] = useState(false);

  const { execute, loading, error } = useApiDelete('secret');

  useEffect(() => {
    const deleteSecret = async () => {
      try {
        await execute(`/secrets/${encodeURIComponent(name)}`);
        setDeleted(true);
      } catch (err) {
        // Error is already handled by useApiDelete
      }
    };

    deleteSecret();
  }, []);

  if (error) {
    return <ErrorComponent error={error} />;
  }

  if (loading) {
    return (
      <Box>
        <Text>Deleting secret...</Text>
      </Box>
    );
  }

  if (deleted) {
    return (
      <Box flexDirection="column">
        <Text color="green">Secret deleted successfully!</Text>
        <Box marginTop={1} paddingLeft={2}>
          <Text>
            <Text bold>Name:</Text> {name}
          </Text>
        </Box>
      </Box>
    );
  }

  return null;
};
