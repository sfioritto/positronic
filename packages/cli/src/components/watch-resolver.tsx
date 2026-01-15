import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { createMachine, state, transition, reduce, invoke, immediate, guard } from 'robot3';
import { useMachine } from 'react-robot';
import { Watch } from './watch.js';
import { ErrorComponent } from './error.js';
import { SelectList } from './select-list.js';
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
  resolvedBrainTitle: string | null;
  resolvedRunId: string | null;
  activeRuns: ActiveRunsResponse['runs'];
  error: ErrorInfo | null;
  // Temporary storage for routing
  brainSearchResult: BrainsResponse | null;
  runSearchResult: BrainRun | null;
  activeRunsResult: ActiveRunsResponse['runs'] | null;
}

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

// Async functions for invoke states
const searchBrains = async (ctx: ResolverContext) => {
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

const searchRun = async (ctx: ResolverContext) => {
  const url = `/brains/runs/${encodeURIComponent(ctx.identifier)}`;
  const response = await apiClient.fetch(url, { method: 'GET' });

  if (response.ok) {
    return (await response.json()) as BrainRun;
  }

  if (response.status === 404) {
    throw {
      title: 'Not Found',
      message: `No brain or run found matching '${ctx.identifier}'.`,
      details:
        'Please check that:\n' +
        '  1. The brain name or run ID is correct\n' +
        '  2. The brain exists in your project\n' +
        '\nYou can list available brains with: positronic list',
    };
  }

  const errorText = await response.text();
  throw {
    title: 'Server Error',
    message: `Error looking up run: ${response.status} ${response.statusText}`,
    details: errorText,
  };
};

const fetchActiveRuns = async (ctx: ResolverContext) => {
  const apiPath = `/brains/${encodeURIComponent(ctx.resolvedBrainTitle!)}/active-runs`;
  const response = await apiClient.fetch(apiPath, { method: 'GET' });

  if (response.status === 200) {
    const { runs } = (await response.json()) as ActiveRunsResponse;
    return runs;
  }

  const errorText = await response.text();
  throw {
    title: 'API Error',
    message: `Failed to get active runs for brain "${ctx.resolvedBrainTitle}".`,
    details: `Server returned ${response.status}: ${errorText}`,
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

// Reducers
const storeBrainSearchResult = reduce(
  (ctx: ResolverContext, ev: { data: BrainsResponse }) => ({ ...ctx, brainSearchResult: ev.data })
);

const storeRunAndResolve = reduce(
  (ctx: ResolverContext, ev: { data: BrainRun }) => ({
    ...ctx,
    runSearchResult: ev.data,
    resolvedRunId: ev.data.brainRunId,
  })
);

const storeActiveRunsResult = reduce(
  (ctx: ResolverContext, ev: { data: ActiveRunsResponse['runs'] }) => ({ ...ctx, activeRunsResult: ev.data })
);

const setErrorFromEvent = reduce(
  (ctx: ResolverContext, ev: { error: unknown }) => ({ ...ctx, error: handleNetworkError(ev.error) })
);

const applyBrainFound = reduce(
  (ctx: ResolverContext) => ({ ...ctx, resolvedBrainTitle: ctx.brainSearchResult!.brains[0].title })
);

const applyBrainsMultiple = reduce(
  (ctx: ResolverContext) => ({ ...ctx, brains: ctx.brainSearchResult!.brains })
);

const applyActiveRunFound = reduce(
  (ctx: ResolverContext) => ({ ...ctx, resolvedRunId: ctx.activeRunsResult![0].brainRunId })
);

const applyMultipleActiveRuns = reduce(
  (ctx: ResolverContext) => ({ ...ctx, activeRuns: ctx.activeRunsResult! })
);

const setBrainTitleFromSelection = reduce(
  (ctx: ResolverContext, ev: { brainTitle: string }) => ({ ...ctx, resolvedBrainTitle: ev.brainTitle })
);

// Guards for routing
const brainFoundGuard = guard<ResolverContext, object>(
  (ctx) => ctx.brainSearchResult?.count === 1
);

const brainNotFoundGuard = guard<ResolverContext, object>(
  (ctx) => ctx.brainSearchResult?.count === 0
);

const brainsMultipleGuard = guard<ResolverContext, object>(
  (ctx) => (ctx.brainSearchResult?.count ?? 0) > 1
);

const activeRunFoundGuard = guard<ResolverContext, object>(
  (ctx) => ctx.activeRunsResult?.length === 1
);

const noActiveRunsGuard = guard<ResolverContext, object>(
  (ctx) => ctx.activeRunsResult?.length === 0
);

const multipleActiveRunsGuard = guard<ResolverContext, object>(
  (ctx) => (ctx.activeRunsResult?.length ?? 0) > 1
);

// State machine definition
const createResolverMachine = (identifier: string) =>
  createMachine(
    'searchingBrain',
    {
      // Invoke state: search for brain by name
      searchingBrain: invoke(
        searchBrains,
        transition('done', 'routeBrainSearch', storeBrainSearchResult),
        transition('error', 'error', setErrorFromEvent)
      ),

      // Route based on brain search result
      routeBrainSearch: state(
        immediate('fetchingActiveRuns', brainFoundGuard, applyBrainFound),
        immediate('searchingRun', brainNotFoundGuard) as any,
        immediate('disambiguating', brainsMultipleGuard, applyBrainsMultiple) as any
      ),

      // Invoke state: search for run by ID
      searchingRun: invoke(
        searchRun,
        transition('done', 'resolved', storeRunAndResolve),
        transition('error', 'error', setErrorFromEvent)
      ),

      // User selects from multiple matching brains
      disambiguating: state(
        transition('BRAIN_SELECTED', 'fetchingActiveRuns', setBrainTitleFromSelection)
      ),

      // Invoke state: fetch active runs for the brain
      fetchingActiveRuns: invoke(
        fetchActiveRuns,
        transition('done', 'routeActiveRuns', storeActiveRunsResult),
        transition('error', 'error', setErrorFromEvent)
      ),

      // Route based on active runs result
      routeActiveRuns: state(
        immediate('resolved', activeRunFoundGuard, applyActiveRunFound),
        immediate('noActiveRuns', noActiveRunsGuard) as any,
        immediate('multipleActiveRuns', multipleActiveRunsGuard, applyMultipleActiveRuns) as any
      ),

      // Terminal states
      resolved: state(),
      noActiveRuns: state(),
      multipleActiveRuns: state(),
      error: state(),
    },
    (): ResolverContext => ({
      identifier,
      brains: [],
      resolvedBrainTitle: null,
      resolvedRunId: null,
      activeRuns: [],
      error: null,
      brainSearchResult: null,
      runSearchResult: null,
      activeRunsResult: null,
    })
  );

interface WatchResolverProps {
  identifier: string;
}

/**
 * WatchResolver - Resolves an identifier to either a brain name or run ID and starts watching.
 *
 * State machine handles all async operations via invoke.
 * Resolution order:
 * 1. Try to resolve as a brain name (fuzzy search)
 * 2. If no brain matches, try as a run ID
 * 3. If neither works, show an error
 */
export const WatchResolver = ({ identifier }: WatchResolverProps) => {
  const machine = useMemo(() => createResolverMachine(identifier), [identifier]);
  const [current, send] = useMachine(machine);

  const currentState = current.name;
  const {
    brains,
    resolvedBrainTitle,
    resolvedRunId,
    activeRuns,
    error,
  } = current.context;

  // Render based on state
  switch (currentState) {
    case 'searchingBrain':
      return (
        <Box>
          <Text>Searching for '{identifier}'...</Text>
        </Box>
      );

    case 'routeBrainSearch':
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

    case 'routeActiveRuns':
      return (
        <Box>
          <Text>Looking for active runs for "{resolvedBrainTitle}"...</Text>
        </Box>
      );

    case 'disambiguating':
      return (
        <SelectList
          items={brains.map((b) => ({ id: b.title, label: b.title, description: b.description }))}
          header={`Multiple brains match '${identifier}':`}
          onSelect={(item) => {
            send({ type: 'BRAIN_SELECTED', brainTitle: item.label });
          }}
        />
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
