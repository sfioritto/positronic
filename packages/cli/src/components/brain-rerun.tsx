import React from 'react';
import { Text, Box } from 'ink';

interface BrainRerunProps {
  brainName: string;
  runId?: string;
  startsAt?: number;
  stopsAfter?: number;
}

export const BrainRerun = ({ brainName, runId, startsAt, stopsAfter }: BrainRerunProps) => {
  const runDetails = runId ? `run ${runId}` : 'latest run';
  const rangeDetails = startsAt || stopsAfter
    ? ` (${startsAt ? `from step ${startsAt}` : ''}${startsAt && stopsAfter ? ' ' : ''}${stopsAfter ? `to step ${stopsAfter}` : ''})`
    : '';

  return (
    <Box flexDirection="column">
      <Text bold>Brain Rerun: {brainName}</Text>
      <Text color="yellow">⚠️  This command is not yet implemented.</Text>
      <Text dimColor>Coming soon: Rerun {runDetails} of {brainName}{rangeDetails}</Text>
    </Box>
  );
};