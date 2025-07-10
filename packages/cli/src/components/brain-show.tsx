import React from 'react';
import { Text, Box } from 'ink';

interface BrainShowProps {
  brainName: string;
}

export const BrainShow = ({ brainName }: BrainShowProps) => {
  return (
    <Box flexDirection="column">
      <Text bold>Brain Details: {brainName}</Text>
      <Text color="yellow">⚠️  This command is not yet implemented.</Text>
      <Text dimColor>Coming soon: Show all steps and details for {brainName}</Text>
    </Box>
  );
};