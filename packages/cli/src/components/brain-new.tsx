import React from 'react';
import { Text, Box } from 'ink';

interface BrainNewProps {
  brainName: string;
  prompt?: string;
}

export const BrainNew = ({ brainName, prompt }: BrainNewProps) => {
  return (
    <Box flexDirection="column">
      <Text bold>Create New Brain: {brainName}</Text>
      <Text color="yellow">⚠️  This command is not yet implemented.</Text>
      <Text dimColor>Coming soon: Create a new brain named {brainName}</Text>
      {prompt && <Text dimColor>With prompt: {prompt}</Text>}
    </Box>
  );
};