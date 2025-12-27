import type { ArgumentsCamelCase } from 'yargs';
import { apiClient, isApiLocalDevMode } from './helpers.js';
import React from 'react';
import { Text } from 'ink';
import { Watch } from '../components/watch.js';
import { BrainList } from '../components/brain-list.js';
import { BrainHistory } from '../components/brain-history.js';
import { RunShow } from '../components/run-show.js';
import { BrainRerun } from '../components/brain-rerun.js';
import { BrainKill } from '../components/brain-kill.js';
import { BrainRun } from '../components/brain-run.js';
import { ErrorComponent } from '../components/error.js';

interface BrainListArgs {}
interface BrainHistoryArgs {
  brain: string;
  limit: number;
}
interface BrainShowArgs {
  runId: string;
}
interface BrainRerunArgs {
  brain: string;
  runId?: string;
  startsAt?: number;
  stopsAfter?: number;
}
interface BrainRunArgs {
  brain: string;
  watch?: boolean;
  options?: Record<string, string>;
}
interface BrainWatchArgs {
  runId?: string;
  brain?: string;
}
interface BrainKillArgs {
  runId: string;
  force: boolean;
}

export class BrainCommand {
  list(argv: ArgumentsCamelCase<BrainListArgs>): React.ReactElement {
    return React.createElement(BrainList);
  }

  history({
    brain,
    limit,
  }: ArgumentsCamelCase<BrainHistoryArgs>): React.ReactElement {
    return React.createElement(BrainHistory, { brainName: brain, limit });
  }

  show({
    runId,
  }: ArgumentsCamelCase<BrainShowArgs>): React.ReactElement {
    return React.createElement(RunShow, { runId });
  }

  rerun({
    brain,
    runId,
    startsAt,
    stopsAfter,
  }: ArgumentsCamelCase<BrainRerunArgs>): React.ReactElement {
    return React.createElement(BrainRerun, {
      identifier: brain,
      runId,
      startsAt,
      stopsAfter,
    });
  }

  run({ brain, watch, options }: ArgumentsCamelCase<BrainRunArgs>): React.ReactElement {
    return React.createElement(BrainRun, {
      identifier: brain,
      watch,
      options,
    });
  }

  async watch({
    runId,
    brain,
  }: ArgumentsCamelCase<BrainWatchArgs>): Promise<React.ReactElement> {
    // If a specific run ID is provided, return the Watch component
    if (runId) {
      return React.createElement(Watch, { runId });
    }

    // If watching by brain identifier is requested, look up active runs
    if (brain) {
      try {
        const apiPath = `/brains/${encodeURIComponent(brain)}/active-runs`;
        const response = await apiClient.fetch(apiPath, {
          method: 'GET',
        });

        if (response.status === 200) {
          const result = await response.json() as { runs: Array<{ brainRunId: string; brainTitle: string; status: string; createdAt: number }> };

          if (result.runs.length === 0) {
            return React.createElement(
              ErrorComponent,
              {
                error: {
                  title: 'No Active Runs',
                  message: `No currently running brain runs found for brain "${brain}".`,
                  details: `To start a new run, use: positronic run ${brain}`
                }
              }
            );
          }

          if (result.runs.length > 1) {
            return React.createElement(
              ErrorComponent,
              {
                error: {
                  title: 'Multiple Active Runs',
                  message: `Found ${result.runs.length} active runs for brain "${brain}".`,
                  details: `Please specify a specific run ID with --run-id:\n${result.runs.map(run => `  positronic watch --run-id ${run.brainRunId}`).join('\n')}`
                }
              }
            );
          }

          // Exactly one active run found - watch it
          const activeRun = result.runs[0];
          return React.createElement(Watch, { runId: activeRun.brainRunId });
        } else {
          const errorText = await response.text();
          return React.createElement(
            ErrorComponent,
            {
              error: {
                title: 'API Error',
                message: `Failed to get active runs for brain "${brain}".`,
                details: `Server returned ${response.status}: ${errorText}`
              }
            }
          );
        }
      } catch (error: any) {
        const connectionError = isApiLocalDevMode()
          ? {
              message: 'Error connecting to the local development server.',
              details: `Please ensure the server is running ('positronic server' or 'px s').\n\nError details: ${error.message}`
            }
          : {
              message: 'Error connecting to the remote project server.',
              details: `Please check your network connection and verify the project URL is correct.\n\nError details: ${error.message}`
            };
        return React.createElement(
          ErrorComponent,
          {
            error: {
              title: 'Connection Error',
              ...connectionError
            }
          }
        );
      }
    }

    // Neither runId nor brainName provided – return an error element.
    return React.createElement(
      Text,
      { color: 'red' as any }, // Ink Text color prop
      'Error: You must provide either a brain run ID or a brain name.'
    );
  }

  kill({
    runId,
    force,
  }: ArgumentsCamelCase<BrainKillArgs>): React.ReactElement {
    return React.createElement(BrainKill, { runId, force });
  }

}
