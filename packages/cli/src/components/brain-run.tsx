import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ErrorComponent } from './error.js';
import { Watch } from './watch.js';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';

interface Brain {
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

interface BrainRunProps {
  identifier: string;
  watch?: boolean;
  options?: Record<string, string>;
}

type Phase = 'searching' | 'disambiguating' | 'running' | 'complete' | 'error';

export const BrainRun = ({ identifier, watch, options }: BrainRunProps) => {
  const [phase, setPhase] = useState<Phase>('searching');
  const [brains, setBrains] = useState<Brain[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);
  const { exit } = useApp();

  const getConnectionError = useCallback(() => {
    if (isApiLocalDevMode()) {
      return {
        title: 'Connection Error',
        message: 'Error connecting to the local development server.',
        details: "Please ensure the server is running ('positronic server' or 'px s').",
      };
    } else {
      return {
        title: 'Connection Error',
        message: 'Error connecting to the remote project server.',
        details: 'Please check your network connection and verify the project URL is correct.',
      };
    }
  }, []);

  const runBrain = useCallback(async (brainTitle: string) => {
    setPhase('running');
    try {
      const response = await apiClient.fetch('/brains/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: brainTitle, options }),
      });

      if (response.status === 201) {
        const result = (await response.json()) as { brainRunId: string };
        setRunId(result.brainRunId);
        setPhase('complete');
      } else if (response.status === 404) {
        setError({
          title: 'Brain Not Found',
          message: `Brain '${brainTitle}' not found.`,
          details: 'The brain may have been removed or renamed since the search.',
        });
        setPhase('error');
      } else {
        const errorText = await response.text();
        setError({
          title: 'Server Error',
          message: `Error starting brain run: ${response.status} ${response.statusText}`,
          details: errorText,
        });
        setPhase('error');
      }
    } catch (err: any) {
      const baseError = getConnectionError();
      setError({
        ...baseError,
        details: `${baseError.details} ${err.message}`,
      });
      setPhase('error');
    }
  }, [options, getConnectionError]);

  // Initial search
  useEffect(() => {
    const searchBrains = async () => {
      try {
        const url = `/brains?q=${encodeURIComponent(identifier)}`;
        const response = await apiClient.fetch(url, { method: 'GET' });

        if (!response.ok) {
          const errorText = await response.text();
          setError({
            title: 'Server Error',
            message: `Error searching for brains: ${response.status} ${response.statusText}`,
            details: errorText,
          });
          setPhase('error');
          return;
        }

        const data = (await response.json()) as BrainsResponse;

        if (data.count === 0) {
          setError({
            title: 'Brain Not Found',
            message: `No brains found matching '${identifier}'.`,
            details: 'Please check that:\n  1. The brain name is spelled correctly\n  2. The brain exists in your project\n  3. The brain has been properly defined and exported\n\nYou can list available brains with: positronic list',
          });
          setPhase('error');
        } else if (data.count === 1) {
          // Exactly one match - run it directly
          await runBrain(data.brains[0].title);
        } else {
          // Multiple matches - show disambiguation UI
          setBrains(data.brains);
          setPhase('disambiguating');
        }
      } catch (err: any) {
        const baseError = getConnectionError();
        setError({
          ...baseError,
          details: `${baseError.details} ${err.message}`,
        });
        setPhase('error');
      }
    };

    searchBrains();
  }, [identifier, runBrain, getConnectionError]);

  // Handle keyboard input for disambiguation
  useInput((input, key) => {
    if (phase !== 'disambiguating') return;

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev - 1 + brains.length) % brains.length);
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev + 1) % brains.length);
    } else if (key.return) {
      const selectedBrain = brains[selectedIndex];
      runBrain(selectedBrain.title);
    } else if (input === 'q' || key.escape) {
      exit();
    }
  });

  // Exit the app when run completes without watch mode
  // This is needed because useInput keeps the terminal in raw mode
  useEffect(() => {
    if (phase === 'complete' && runId && !watch) {
      exit();
    }
  }, [phase, runId, watch, exit]);

  // Maintain consistent Box wrapper to help Ink properly calculate
  // terminal clearing between renders (prevents appending instead of overwriting)
  return (
    <Box flexDirection="column">
      {phase === 'searching' ? (
        <Text>Searching for brain '{identifier}'...</Text>
      ) : phase === 'error' && error ? (
        <ErrorComponent error={error} />
      ) : phase === 'disambiguating' ? (
        <>
          <Text bold>Multiple brains match '{identifier}':</Text>
          <Box marginTop={1} flexDirection="column">
            {brains.map((brain, index) => {
              const isSelected = index === selectedIndex;
              return (
                <Box key={brain.title} flexDirection="column" marginBottom={1}>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '▶ ' : '  '}
                    <Text bold>{brain.title}</Text>
                  </Text>
                  <Text dimColor>
                    {'    '}
                    {brain.description}
                  </Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              Use arrow keys to navigate, Enter to select, q to quit
            </Text>
          </Box>
        </>
      ) : phase === 'running' ? (
        <Text>Starting brain run...</Text>
      ) : phase === 'complete' && runId ? (
        watch ? (
          <Watch runId={runId} />
        ) : (
          <Text>Run ID: {runId}</Text>
        )
      ) : null}
    </Box>
  );
};
