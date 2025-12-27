import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Watch } from './watch.js';
import { BrainResolver } from './brain-resolver.js';
import { ErrorComponent } from './error.js';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';

interface ActiveRunsResponse {
  runs: Array<{
    brainRunId: string;
    brainTitle: string;
    status: string;
    createdAt: number;
  }>;
}

interface BrainWatchByTitleProps {
  brainTitle: string;
}

/**
 * BrainWatchByTitle - Watches a brain's active run by its resolved title.
 *
 * Looks up active runs for the brain and:
 * - If 0 active runs: shows a message
 * - If 1 active run: starts watching it
 * - If multiple: shows the list of run IDs to choose from
 */
const BrainWatchByTitle = ({ brainTitle }: BrainWatchByTitleProps) => {
  const [phase, setPhase] = useState<'loading' | 'watching' | 'error' | 'no-runs' | 'multiple-runs'>('loading');
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ActiveRunsResponse['runs']>([]);
  const [error, setError] = useState<{
    title: string;
    message: string;
    details?: string;
  } | null>(null);

  useEffect(() => {
    const fetchActiveRuns = async () => {
      try {
        const apiPath = `/brains/${encodeURIComponent(brainTitle)}/active-runs`;
        const response = await apiClient.fetch(apiPath, {
          method: 'GET',
        });

        if (response.status === 200) {
          const result = (await response.json()) as ActiveRunsResponse;

          if (result.runs.length === 0) {
            setPhase('no-runs');
          } else if (result.runs.length === 1) {
            setRunId(result.runs[0].brainRunId);
            setPhase('watching');
          } else {
            setRuns(result.runs);
            setPhase('multiple-runs');
          }
        } else {
          const errorText = await response.text();
          setError({
            title: 'API Error',
            message: `Failed to get active runs for brain "${brainTitle}".`,
            details: `Server returned ${response.status}: ${errorText}`,
          });
          setPhase('error');
        }
      } catch (err: any) {
        const connectionError = isApiLocalDevMode()
          ? {
              message: 'Error connecting to the local development server.',
              details: `Please ensure the server is running ('positronic server' or 'px s').\n\nError details: ${err.message}`,
            }
          : {
              message: 'Error connecting to the remote project server.',
              details: `Please check your network connection and verify the project URL is correct.\n\nError details: ${err.message}`,
            };
        setError({
          title: 'Connection Error',
          ...connectionError,
        });
        setPhase('error');
      }
    };

    fetchActiveRuns();
  }, [brainTitle]);

  if (phase === 'loading') {
    return (
      <Box>
        <Text>Looking for active runs for "{brainTitle}"...</Text>
      </Box>
    );
  }

  if (phase === 'error' && error) {
    return <ErrorComponent error={error} />;
  }

  if (phase === 'no-runs') {
    return (
      <ErrorComponent
        error={{
          title: 'No Active Runs',
          message: `No currently running brain runs found for brain "${brainTitle}".`,
          details: `To start a new run, use: positronic run ${brainTitle}`,
        }}
      />
    );
  }

  if (phase === 'multiple-runs') {
    return (
      <ErrorComponent
        error={{
          title: 'Multiple Active Runs',
          message: `Found ${runs.length} active runs for brain "${brainTitle}".`,
          details: `Please specify a specific run ID with --run-id:\n${runs.map((run) => `  positronic watch --run-id ${run.brainRunId}`).join('\n')}`,
        }}
      />
    );
  }

  if (phase === 'watching' && runId) {
    return <Watch runId={runId} />;
  }

  return null;
};

interface BrainWatchWithResolverProps {
  identifier: string;
}

/**
 * BrainWatchWithResolver - Resolves a brain identifier and watches its active run.
 *
 * Uses BrainResolver to handle fuzzy matching and disambiguation,
 * then finds and watches the brain's active run.
 */
export const BrainWatchWithResolver = ({ identifier }: BrainWatchWithResolverProps) => {
  return (
    <BrainResolver identifier={identifier}>
      {(resolvedBrainTitle) => <BrainWatchByTitle brainTitle={resolvedBrainTitle} />}
    </BrainResolver>
  );
};
