import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { apiClient } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';

interface BrainRerunProps {
  brainName: string;
  runId?: string;
  startsAt?: number;
  stopsAfter?: number;
}

interface BrainRerunResponse {
  brainRunId: string;
}

export const BrainRerun = ({ brainName, runId, startsAt, stopsAfter }: BrainRerunProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRunId, setNewRunId] = useState<string | null>(null);

  useEffect(() => {
    const rerunBrain = async () => {
      try {
        const body: any = { brainName };
        if (runId) body.runId = runId;
        if (startsAt !== undefined) body.startsAt = startsAt;
        if (stopsAfter !== undefined) body.stopsAfter = stopsAfter;

        const response = await apiClient.fetch('/brains/runs/rerun', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (response.status === 201) {
          const result = (await response.json()) as BrainRerunResponse;
          setNewRunId(result.brainRunId);
        } else if (response.status === 404) {
          const errorData = await response.json();
          setError(errorData.error || `Brain or run not found`);
        } else {
          const errorText = await response.text();
          setError(`Server returned ${response.status}: ${errorText}`);
        }
      } catch (err: any) {
        setError(`Connection error: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    rerunBrain();
  }, [brainName, runId, startsAt, stopsAfter]);

  if (isLoading) {
    return (
      <Box>
        <Text>🔄 Starting brain rerun...</Text>
      </Box>
    );
  }

  if (error) {
    const errorDetails = runId 
      ? `Make sure the brain "${brainName}" and run ID "${runId}" exist.\nYou can list brain history with: positronic brain history ${brainName}`
      : `Make sure the brain "${brainName}" exists.\nYou can list available brains with: positronic brain list`;

    return (
      <ErrorComponent
        error={{
          title: 'Brain Rerun Failed',
          message: error,
          details: errorDetails
        }}
      />
    );
  }

  if (newRunId) {
    const runDetails = runId ? ` from run ${runId}` : '';
    const rangeDetails = startsAt || stopsAfter
      ? ` (${startsAt ? `starting at step ${startsAt}` : ''}${startsAt && stopsAfter ? ', ' : ''}${stopsAfter ? `stopping after step ${stopsAfter}` : ''})`
      : '';

    return (
      <Box flexDirection="column">
        <Text bold color="green">✅ Brain rerun started successfully!</Text>
        <Text>
          New run ID: <Text bold>{newRunId}</Text>
        </Text>
        <Text dimColor>
          Rerunning brain "{brainName}"{runDetails}{rangeDetails}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Watch the run with: positronic watch --run-id {newRunId}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="red">❌ Unexpected error occurred</Text>
    </Box>
  );
};