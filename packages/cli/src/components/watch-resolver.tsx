import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import * as robot3 from 'robot3';
import { Watch } from './watch.js';
import { ErrorComponent } from './error.js';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';

const { createMachine, state, transition, reduce, interpret } = robot3;

// Types
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

interface ErrorInfo {
  title: string;
  message: string;
  details?: string;
}

// State machine context
interface ResolverContext {
  identifier: string;
  brains: Brain[];
  selectedIndex: number;
  resolvedBrainTitle: string | null;
  resolvedRunId: string | null;
  activeRuns: ActiveRunsResponse['runs'];
  error: ErrorInfo | null;
}

// Events
const EVENTS = {
  BRAIN_FOUND: 'BRAIN_FOUND',
  BRAIN_NOT_FOUND: 'BRAIN_NOT_FOUND',
  BRAINS_MULTIPLE: 'BRAINS_MULTIPLE',
  RUN_FOUND: 'RUN_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  BRAIN_SELECTED: 'BRAIN_SELECTED',
  ACTIVE_RUN_FOUND: 'ACTIVE_RUN_FOUND',
  NO_ACTIVE_RUNS: 'NO_ACTIVE_RUNS',
  MULTIPLE_ACTIVE_RUNS: 'MULTIPLE_ACTIVE_RUNS',
  ERROR: 'ERROR',
} as const;

// Reducers - using object destructuring as requested
const setBrainTitle = reduce(
  (ctx: ResolverContext, { brainTitle }: { brainTitle: string }) => ({ ...ctx, resolvedBrainTitle: brainTitle })
);

const setBrains = reduce(
  (ctx: ResolverContext, { brains }: { brains: Brain[] }) => ({ ...ctx, brains, selectedIndex: 0 })
);

const setRunId = reduce(
  (ctx: ResolverContext, { runId }: { runId: string }) => ({ ...ctx, resolvedRunId: runId })
);

const setActiveRuns = reduce(
  (ctx: ResolverContext, { runs }: { runs: ActiveRunsResponse['runs'] }) => ({ ...ctx, activeRuns: runs })
);

const setError = reduce(
  (ctx: ResolverContext, { error }: { error: ErrorInfo }) => ({ ...ctx, error })
);

// State machine definition
// Note: Using `as any` to work around robot3's strict transition typing
const createResolverMachine = (identifier: string) =>
  createMachine(
    'searchingBrain',
    {
      searchingBrain: state(
        transition(EVENTS.BRAIN_FOUND, 'fetchingActiveRuns', setBrainTitle),
        transition(EVENTS.BRAIN_NOT_FOUND, 'searchingRun') as any,
        transition(EVENTS.BRAINS_MULTIPLE, 'disambiguating', setBrains) as any,
        transition(EVENTS.ERROR, 'error', setError) as any
      ),

      searchingRun: state(
        transition(EVENTS.RUN_FOUND, 'resolved', setRunId),
        transition(EVENTS.NOT_FOUND, 'error', setError) as any,
        transition(EVENTS.ERROR, 'error', setError) as any
      ),

      disambiguating: state(
        transition(EVENTS.BRAIN_SELECTED, 'fetchingActiveRuns', setBrainTitle)
      ),

      fetchingActiveRuns: state(
        transition(EVENTS.ACTIVE_RUN_FOUND, 'resolved', setRunId),
        transition(EVENTS.NO_ACTIVE_RUNS, 'noActiveRuns') as any,
        transition(EVENTS.MULTIPLE_ACTIVE_RUNS, 'multipleActiveRuns', setActiveRuns) as any,
        transition(EVENTS.ERROR, 'error', setError) as any
      ),

      resolved: state(),
      noActiveRuns: state(),
      multipleActiveRuns: state(),
      error: state(),
    },
    () => ({
      identifier,
      brains: [],
      selectedIndex: 0,
      resolvedBrainTitle: null,
      resolvedRunId: null,
      activeRuns: [],
      error: null,
    })
  );

// Helper to get connection error message
const getConnectionError = () => {
  if (isApiLocalDevMode()) {
    return {
      title: 'Connection Error',
      message: 'Error connecting to the local development server.',
      details: "Please ensure the server is running ('positronic server' or 'px s').",
    };
  }
  return {
    title: 'Connection Error',
    message: 'Error connecting to the remote project server.',
    details: 'Please check your network connection and verify the project URL is correct.',
  };
};

interface WatchResolverProps {
  identifier: string;
}

/**
 * WatchResolver - Resolves an identifier to either a brain name or run ID and starts watching.
 *
 * State machine handles state/transitions, useEffect triggers async operations.
 * Resolution order:
 * 1. Try to resolve as a brain name (fuzzy search)
 * 2. If no brain matches, try as a run ID
 * 3. If neither works, show an error
 */
export const WatchResolver = ({ identifier }: WatchResolverProps) => {
  const serviceRef = useRef(interpret(createResolverMachine(identifier), () => forceUpdate({})));
  const [, forceUpdate] = useState({});
  const { exit } = useApp();

  const { machine, context, send } = serviceRef.current;
  const currentState = machine.current;
  const {
    brains,
    selectedIndex,
    resolvedBrainTitle,
    resolvedRunId,
    activeRuns,
    error,
  } = context;

  // Single effect that runs async operations based on current state
  useEffect(() => {
    let cancelled = false;

    const runStateAction = async () => {
      switch (currentState) {
        case 'searchingBrain': {
          try {
            const url = `/brains?q=${encodeURIComponent(identifier)}`;
            const response = await apiClient.fetch(url, { method: 'GET' });

            if (cancelled) return;

            if (!response.ok) {
              const errorText = await response.text();
              send({
                type: EVENTS.ERROR,
                error: {
                  title: 'Server Error',
                  message: `Error searching for brains: ${response.status} ${response.statusText}`,
                  details: errorText,
                },
              } as any);
              return;
            }

            const { brains: foundBrains, count } = (await response.json()) as BrainsResponse;

            if (cancelled) return;

            if (count === 0) {
              send({ type: EVENTS.BRAIN_NOT_FOUND } as any);
            } else if (count === 1) {
              send({ type: EVENTS.BRAIN_FOUND, brainTitle: foundBrains[0].title } as any);
            } else {
              send({ type: EVENTS.BRAINS_MULTIPLE, brains: foundBrains } as any);
            }
          } catch (err) {
            if (cancelled) return;
            const baseError = getConnectionError();
            const message = err instanceof Error ? err.message : String(err);
            send({
              type: EVENTS.ERROR,
              error: { ...baseError, details: `${baseError.details} ${message}` },
            } as any);
          }
          break;
        }

        case 'searchingRun': {
          try {
            const url = `/brains/runs/${encodeURIComponent(identifier)}`;
            const response = await apiClient.fetch(url, { method: 'GET' });

            if (cancelled) return;

            if (response.ok) {
              const { brainRunId } = (await response.json()) as BrainRun;
              send({ type: EVENTS.RUN_FOUND, runId: brainRunId } as any);
            } else if (response.status === 404) {
              send({
                type: EVENTS.NOT_FOUND,
                error: {
                  title: 'Not Found',
                  message: `No brain or run found matching '${identifier}'.`,
                  details:
                    'Please check that:\n' +
                    '  1. The brain name or run ID is correct\n' +
                    '  2. The brain exists in your project\n' +
                    '\nYou can list available brains with: positronic list',
                },
              } as any);
            } else {
              const errorText = await response.text();
              send({
                type: EVENTS.ERROR,
                error: {
                  title: 'Server Error',
                  message: `Error looking up run: ${response.status} ${response.statusText}`,
                  details: errorText,
                },
              } as any);
            }
          } catch (err) {
            if (cancelled) return;
            const baseError = getConnectionError();
            const message = err instanceof Error ? err.message : String(err);
            send({
              type: EVENTS.ERROR,
              error: { ...baseError, details: `${baseError.details} ${message}` },
            } as any);
          }
          break;
        }

        case 'fetchingActiveRuns': {
          if (!resolvedBrainTitle) return;

          try {
            const apiPath = `/brains/${encodeURIComponent(resolvedBrainTitle)}/active-runs`;
            const response = await apiClient.fetch(apiPath, { method: 'GET' });

            if (cancelled) return;

            if (response.status === 200) {
              const { runs } = (await response.json()) as ActiveRunsResponse;

              if (runs.length === 0) {
                send({ type: EVENTS.NO_ACTIVE_RUNS } as any);
              } else if (runs.length === 1) {
                send({ type: EVENTS.ACTIVE_RUN_FOUND, runId: runs[0].brainRunId } as any);
              } else {
                send({ type: EVENTS.MULTIPLE_ACTIVE_RUNS, runs } as any);
              }
            } else {
              const errorText = await response.text();
              send({
                type: EVENTS.ERROR,
                error: {
                  title: 'API Error',
                  message: `Failed to get active runs for brain "${resolvedBrainTitle}".`,
                  details: `Server returned ${response.status}: ${errorText}`,
                },
              } as any);
            }
          } catch (err) {
            if (cancelled) return;
            const baseError = getConnectionError();
            const message = err instanceof Error ? err.message : String(err);
            send({
              type: EVENTS.ERROR,
              error: { ...baseError, details: `${baseError.details} ${message}` },
            } as any);
          }
          break;
        }
      }
    };

    runStateAction();

    return () => {
      cancelled = true;
    };
  }, [currentState, identifier, resolvedBrainTitle, send]);

  // Handle keyboard input for brain disambiguation
  useInput((input, key) => {
    if (currentState !== 'disambiguating') return;

    if (key.upArrow) {
      context.selectedIndex = (selectedIndex - 1 + brains.length) % brains.length;
      forceUpdate({});
    } else if (key.downArrow) {
      context.selectedIndex = (selectedIndex + 1) % brains.length;
      forceUpdate({});
    } else if (key.return) {
      const { title } = brains[selectedIndex];
      send({ type: EVENTS.BRAIN_SELECTED, brainTitle: title });
    } else if (input === 'q' || key.escape) {
      exit();
    }
  });

  // Render based on state
  switch (currentState) {
    case 'searchingBrain':
      return (
        <Box>
          <Text>Searching for '{identifier}'...</Text>
        </Box>
      );

    case 'searchingRun':
      return (
        <Box>
          <Text>Checking if '{identifier}' is a run ID...</Text>
        </Box>
      );

    case 'fetchingActiveRuns':
      return (
        <Box>
          <Text>Looking for active runs for "{resolvedBrainTitle}"...</Text>
        </Box>
      );

    case 'disambiguating':
      return (
        <Box flexDirection="column">
          <Text bold>Multiple brains match '{identifier}':</Text>
          <Box marginTop={1} flexDirection="column">
            {brains.map((brain, index) => {
              const isSelected = index === selectedIndex;
              const { title, description } = brain;
              return (
                <Box key={title} flexDirection="column" marginBottom={1}>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '> ' : '  '}
                    <Text bold>{title}</Text>
                  </Text>
                  <Text dimColor>
                    {'    '}
                    {description}
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

    case 'noActiveRuns':
      return (
        <ErrorComponent
          error={{
            title: 'No Active Runs',
            message: `No currently running brain runs found for brain "${resolvedBrainTitle}".`,
            details: `To start a new run, use: positronic run ${resolvedBrainTitle}`,
          }}
        />
      );

    case 'multipleActiveRuns':
      return (
        <ErrorComponent
          error={{
            title: 'Multiple Active Runs',
            message: `Found ${activeRuns.length} active runs for brain "${resolvedBrainTitle}".`,
            details: `Please specify a specific run ID:\n${activeRuns.map(({ brainRunId }) => `  positronic watch ${brainRunId}`).join('\n')}`,
          }}
        />
      );

    case 'error':
      return error ? <ErrorComponent error={error} /> : null;

    case 'resolved':
      return resolvedRunId ? <Watch runId={resolvedRunId} /> : null;

    default:
      return null;
  }
};
