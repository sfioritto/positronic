import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Watch } from './watch.js';
import { ErrorComponent } from './error.js';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';
import { STATUS } from '@positronic/core';

interface Brain {
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

interface ActiveRunsResponse {
  runs: Array<{
    brainRunId: string;
    brainTitle: string;
    status: string;
    createdAt: number;
  }>;
}

interface BrainRun {
  brainRunId: string;
  brainTitle: string;
  status: string;
}

interface WatchResolverProps {
  identifier: string;
}

type Phase =
  | 'searching-brain'
  | 'searching-run'
  | 'disambiguating'
  | 'fetching-active-runs'
  | 'resolved-run'
  | 'no-active-runs'
  | 'multiple-active-runs'
  | 'error';

/**
 * WatchResolver - Resolves an identifier to either a brain name or run ID and starts watching.
 *
 * Resolution order:
 * 1. Try to resolve as a brain name (fuzzy search)
 * 2. If no brain matches, try as a run ID
 * 3. If neither works, show an error
 *
 * If resolved as a brain, looks up active runs and watches the appropriate one.
 */
export const WatchResolver = ({ identifier }: WatchResolverProps) => {
  const [phase, setPhase] = useState<Phase>('searching-brain');
  const [brains, setBrains] = useState<Brain[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resolvedRunId, setResolvedRunId] = useState<string | null>(null);
  const [resolvedBrainTitle, setResolvedBrainTitle] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRunsResponse['runs']>([]);
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

  // Phase 1: Search for brain by name
  useEffect(() => {
    if (phase !== 'searching-brain') return;

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
          // No brain found, try as run ID
          setPhase('searching-run');
        } else if (data.count === 1) {
          // Exactly one brain match - look up active runs
          setResolvedBrainTitle(data.brains[0].title);
          setPhase('fetching-active-runs');
        } else {
          // Multiple brain matches - show disambiguation UI
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
  }, [phase, identifier, getConnectionError]);

  // Phase 2: If no brain found, try as run ID
  useEffect(() => {
    if (phase !== 'searching-run') return;

    const searchRun = async () => {
      try {
        const url = `/brains/runs/${encodeURIComponent(identifier)}`;
        const response = await apiClient.fetch(url, { method: 'GET' });

        if (response.ok) {
          // Found as run ID - watch it directly
          const data = (await response.json()) as BrainRun;
          setResolvedRunId(data.brainRunId);
          setPhase('resolved-run');
        } else if (response.status === 404) {
          // Neither brain nor run found
          setError({
            title: 'Not Found',
            message: `No brain or run found matching '${identifier}'.`,
            details:
              'Please check that:\n' +
              '  1. The brain name or run ID is correct\n' +
              '  2. The brain exists in your project\n' +
              '\nYou can list available brains with: positronic list',
          });
          setPhase('error');
        } else {
          const errorText = await response.text();
          setError({
            title: 'Server Error',
            message: `Error looking up run: ${response.status} ${response.statusText}`,
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
    };

    searchRun();
  }, [phase, identifier, getConnectionError]);

  // Phase 3: Fetch active runs for resolved brain
  useEffect(() => {
    if (phase !== 'fetching-active-runs' || !resolvedBrainTitle) return;

    const fetchActiveRuns = async () => {
      try {
        const apiPath = `/brains/${encodeURIComponent(resolvedBrainTitle)}/active-runs`;
        const response = await apiClient.fetch(apiPath, { method: 'GET' });

        if (response.status === 200) {
          const result = (await response.json()) as ActiveRunsResponse;

          if (result.runs.length === 0) {
            setPhase('no-active-runs');
          } else if (result.runs.length === 1) {
            setResolvedRunId(result.runs[0].brainRunId);
            setPhase('resolved-run');
          } else {
            setActiveRuns(result.runs);
            setPhase('multiple-active-runs');
          }
        } else {
          const errorText = await response.text();
          setError({
            title: 'API Error',
            message: `Failed to get active runs for brain "${resolvedBrainTitle}".`,
            details: `Server returned ${response.status}: ${errorText}`,
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
    };

    fetchActiveRuns();
  }, [phase, resolvedBrainTitle, getConnectionError]);

  // Handle keyboard input for brain disambiguation
  useInput((input, key) => {
    if (phase !== 'disambiguating') return;

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev - 1 + brains.length) % brains.length);
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev + 1) % brains.length);
    } else if (key.return) {
      const selectedBrain = brains[selectedIndex];
      setResolvedBrainTitle(selectedBrain.title);
      setPhase('fetching-active-runs');
    } else if (input === 'q' || key.escape) {
      exit();
    }
  });

  // Render based on phase
  if (phase === 'searching-brain') {
    return (
      <Box>
        <Text>Searching for '{identifier}'...</Text>
      </Box>
    );
  }

  if (phase === 'searching-run') {
    return (
      <Box>
        <Text>Checking if '{identifier}' is a run ID...</Text>
      </Box>
    );
  }

  if (phase === 'fetching-active-runs') {
    return (
      <Box>
        <Text>Looking for active runs for "{resolvedBrainTitle}"...</Text>
      </Box>
    );
  }

  if (phase === 'error' && error) {
    return <ErrorComponent error={error} />;
  }

  if (phase === 'disambiguating') {
    return (
      <Box flexDirection="column">
        <Text bold>Multiple brains match '{identifier}':</Text>
        <Box marginTop={1} flexDirection="column">
          {brains.map((brain, index) => {
            const isSelected = index === selectedIndex;
            return (
              <Box key={brain.title} flexDirection="column" marginBottom={1}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '> ' : '  '}
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
          <Text dimColor>Use arrow keys to navigate, Enter to select, q to quit</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'no-active-runs') {
    return (
      <ErrorComponent
        error={{
          title: 'No Active Runs',
          message: `No currently running brain runs found for brain "${resolvedBrainTitle}".`,
          details: `To start a new run, use: positronic run ${resolvedBrainTitle}`,
        }}
      />
    );
  }

  if (phase === 'multiple-active-runs') {
    return (
      <ErrorComponent
        error={{
          title: 'Multiple Active Runs',
          message: `Found ${activeRuns.length} active runs for brain "${resolvedBrainTitle}".`,
          details: `Please specify a specific run ID:\n${activeRuns.map((run) => `  positronic watch ${run.brainRunId}`).join('\n')}`,
        }}
      />
    );
  }

  if (phase === 'resolved-run' && resolvedRunId) {
    return <Watch runId={resolvedRunId} />;
  }

  return null;
};
