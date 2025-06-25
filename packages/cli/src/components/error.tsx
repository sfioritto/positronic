import React from 'react';
import { Box, Text } from 'ink';

interface ErrorComponentProps {
  error: {
    title: string;
    message: string;
    details?: string;
  };
}

export const ErrorComponent = ({ error }: ErrorComponentProps) => {
  return (
    <Box flexDirection="column">
      <Text color="red" bold>❌ {error.title}</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text color="red">{error.message}</Text>
        {error.details && (
          <Text color="red" dimColor>{error.details}</Text>
        )}
      </Box>
    </Box>
  );
};