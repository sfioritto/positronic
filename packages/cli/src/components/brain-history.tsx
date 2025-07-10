import React from 'react';
import { Text, Box } from 'ink';

interface BrainHistoryProps {
  brainName: string;
  limit: number;
}

export const BrainHistory = ({ brainName, limit }: BrainHistoryProps) => {
  return (
    <Box flexDirection="column">
      <Text bold>Brain History: {brainName}</Text>
      <Text color="yellow">⚠️  This command is not yet implemented.</Text>
      <Text dimColor>Coming soon: Show recent runs for {brainName} (limit: {limit})</Text>
    </Box>
  );
};