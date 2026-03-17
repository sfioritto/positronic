import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { apiClient } from '../commands/helpers.js';
import { ErrorComponent } from './error.js';

interface BrainRerunProps {
  runId: string;
  startsAt: number;
}

export const BrainRerun = ({ runId, startsAt }: BrainRerunProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [brainTitle, setBrainTitle] = useState<string | null>(null);

  useEffect(() => {
    const rerunBrain = async () => {
      try {
        const response = await apiClient.fetch('/brains/runs/rerun', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ runId, startsAt }),
        });

        if (response.status === 200) {
          const data = (await response.json()) as {
            brainRunId: string;
            brainTitle: string;
          };
          setBrainTitle(data.brainTitle);
          setSuccess(true);
        } else if (response.status === 404) {
          const errorData = await response.json();
          setError(errorData.error || `Run not found`);
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
  }, [runId, startsAt]);

  const errorDetails = `Make sure run ID "${runId}" exists.\nYou can list brain history with: positronic brain history <brain>`;

  return (
    <Box flexDirection="column">
      {isLoading ? (
        <Text>Rerunning brain from step {startsAt}...</Text>
      ) : error ? (
        <ErrorComponent
          error={{
            title: 'Brain Rerun Failed',
            message: error,
            details: errorDetails,
          }}
        />
      ) : success ? (
        <>
          <Text bold color="green">
            Brain rerun started successfully!
          </Text>
          <Text dimColor>
            Rerunning "{brainTitle}" from step {startsAt}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>Watch the run with: positronic watch {runId}</Text>
          </Box>
        </>
      ) : (
        <Text color="red">Unexpected error occurred</Text>
      )}
    </Box>
  );
};
