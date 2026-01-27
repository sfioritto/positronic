import React, { useMemo, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { createMachine, state, transition, reduce, invoke, immediate, guard } from 'robot3';
import { useMachine } from 'react-robot';
import { ErrorComponent } from './error.js';
import { SelectList } from './select-list.js';
import { Watch } from './watch.js';
import { apiClient, isApiLocalDevMode } from '../commands/helpers.js';

// Types
interface Brain {
  title: string;
  description: string;
}

interface BrainsResponse {
  brains: Brain[];
  count: number;
}

interface ErrorInfo {
  title: string;
  message: string;
  details?: string;
}

interface BrainRunContext {
  identifier: string;
  watch: boolean;
  options: Record<string, string> | undefined;
  brainSearchResult: BrainsResponse | null;
  brains: Brain[];
  selectedBrainTitle: string | null;
  runId: string | null;
  error: ErrorInfo | null;
}

interface BrainRunProps {
  identifier: string;
  watch?: boolean;
  options?: Record<string, string>;
}

// Helper to get connection error message
const getConnectionError = (): ErrorInfo => {
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

// Error handler for network errors
const handleNetworkError = (err: unknown): ErrorInfo => {
  // If it's already an ErrorInfo object (thrown from our async functions)
  if (err && typeof err === 'object' && 'title' in err && 'message' in err) {
    return err as ErrorInfo;
  }
  // Network/connection error
  const baseError = getConnectionError();
  const message = err instanceof Error ? err.message : String(err);
  return { ...baseError, details: `${baseError.details} ${message}` };
};

// Async functions for invoke states
const searchBrains = async (ctx: BrainRunContext) => {
  const url = `/brains?q=${encodeURIComponent(ctx.identifier)}`;
  const response = await apiClient.fetch(url, { method: 'GET' });

  if (!response.ok) {
    const errorText = await response.text();
    throw {
      title: 'Server Error',
      message: `Error searching for brains: ${response.status} ${response.statusText}`,
      details: errorText,
    };
  }

  return (await response.json()) as BrainsResponse;
};

const startRun = async (ctx: BrainRunContext) => {
  const response = await apiClient.fetch('/brains/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: ctx.selectedBrainTitle, options: ctx.options }),
  });

  if (response.status === 201) {
    return (await response.json()) as { brainRunId: string };
  }

  if (response.status === 404) {
    throw {
      title: 'Brain Not Found',
      message: `Brain '${ctx.selectedBrainTitle}' not found.`,
      details: 'The brain may have been removed or renamed since the search.',
    };
  }

  const errorText = await response.text();
  throw {
    title: 'Server Error',
    message: `Error starting brain run: ${response.status} ${response.statusText}`,
    details: errorText,
  };
};

// Reducers
const storeBrainSearchResult = reduce(
  (ctx: BrainRunContext, ev: { data: BrainsResponse }) => ({ ...ctx, brainSearchResult: ev.data })
);

const applySingleBrainFound = reduce((ctx: BrainRunContext) => ({
  ...ctx,
  selectedBrainTitle: ctx.brainSearchResult!.brains[0].title,
}));

const applyBrainsMultiple = reduce((ctx: BrainRunContext) => ({
  ...ctx,
  brains: ctx.brainSearchResult!.brains,
}));

const applyBrainNotFoundError = reduce((ctx: BrainRunContext) => ({
  ...ctx,
  error: {
    title: 'Brain Not Found',
    message: `No brains found matching '${ctx.identifier}'.`,
    details:
      'Please check that:\n  1. The brain name is spelled correctly\n  2. The brain exists in your project\n  3. The brain has been properly defined and exported\n\nYou can list available brains with: positronic list',
  },
}));

const setBrainTitleFromSelection = reduce(
  (ctx: BrainRunContext, ev: { brainTitle: string }) => ({ ...ctx, selectedBrainTitle: ev.brainTitle })
);

const storeRunResult = reduce(
  (ctx: BrainRunContext, ev: { data: { brainRunId: string } }) => ({ ...ctx, runId: ev.data.brainRunId })
);

const setErrorFromEvent = reduce(
  (ctx: BrainRunContext, ev: { error: unknown }) => ({ ...ctx, error: handleNetworkError(ev.error) })
);

// Guards for routing
const brainFoundGuard = guard<BrainRunContext, object>((ctx) => ctx.brainSearchResult?.count === 1);

const brainNotFoundGuard = guard<BrainRunContext, object>((ctx) => ctx.brainSearchResult?.count === 0);

const brainsMultipleGuard = guard<BrainRunContext, object>((ctx) => (ctx.brainSearchResult?.count ?? 0) > 1);

// State machine definition
const createBrainRunMachine = (identifier: string, watch: boolean, options: Record<string, string> | undefined) =>
  createMachine(
    'searching',
    {
      // Invoke state: search for brain by name
      searching: invoke(
        searchBrains,
        transition('done', 'routeSearch', storeBrainSearchResult),
        transition('error', 'error', setErrorFromEvent)
      ),

      // Route based on brain search result
      routeSearch: state(
        immediate('running', brainFoundGuard, applySingleBrainFound),
        immediate('error', brainNotFoundGuard, applyBrainNotFoundError) as any,
        immediate('disambiguating', brainsMultipleGuard, applyBrainsMultiple) as any
      ),

      // User selects from multiple matching brains
      disambiguating: state(transition('BRAIN_SELECTED', 'running', setBrainTitleFromSelection)),

      // Invoke state: start the brain run
      running: invoke(
        startRun,
        transition('done', 'complete', storeRunResult),
        transition('error', 'error', setErrorFromEvent)
      ),

      // Terminal states
      complete: state(),
      error: state(),
    },
    (): BrainRunContext => ({
      identifier,
      watch,
      options,
      brainSearchResult: null,
      brains: [],
      selectedBrainTitle: null,
      runId: null,
      error: null,
    })
  );

/**
 * BrainRun - Searches for a brain by identifier and runs it.
 *
 * State machine handles all async operations via invoke.
 * Flow:
 * 1. Search for brain by name (fuzzy search)
 * 2. If single match, run it; if multiple, show disambiguation UI; if none, show error
 * 3. Start the brain run
 * 4. Show run ID or Watch component based on watch flag
 */
export const BrainRun = ({ identifier, watch = false, options }: BrainRunProps) => {
  const machine = useMemo(
    () => createBrainRunMachine(identifier, watch, options),
    [identifier, watch, options]
  );
  const [current, send] = useMachine(machine);
  const { exit } = useApp();

  const currentState = current.name;
  const { brains, runId, error } = current.context;

  // Exit the app when run completes without watch mode
  useEffect(() => {
    if (currentState === 'complete' && runId && !watch) {
      exit();
    }
  }, [currentState, runId, watch, exit]);

  // Render based on state
  switch (currentState) {
    case 'searching':
    case 'routeSearch':
      return (
        <Box flexDirection="column">
          <Text>Searching for brain '{identifier}'...</Text>
        </Box>
      );

    case 'disambiguating':
      return (
        <Box flexDirection="column">
          <SelectList
            items={brains.map((b) => ({ id: b.title, label: b.title, description: b.description }))}
            header={`Multiple brains match '${identifier}':`}
            onSelect={(item) => {
              send({ type: 'BRAIN_SELECTED', brainTitle: item.label });
            }}
          />
        </Box>
      );

    case 'running':
      return (
        <Box flexDirection="column">
          <Text>Starting brain run...</Text>
        </Box>
      );

    case 'complete':
      if (!runId) return null;
      return (
        <Box flexDirection="column">
          {watch ? <Watch runId={runId} /> : <Text>Run ID: {runId}</Text>}
        </Box>
      );

    case 'error':
      return (
        <Box flexDirection="column">
          {error ? <ErrorComponent error={error} /> : null}
        </Box>
      );

    default:
      return null;
  }
};
