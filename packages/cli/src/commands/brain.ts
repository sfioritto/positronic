import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { Watch } from '../components/watch.js';
import { BrainList } from '../components/brain-list.js';
import { BrainHistory } from '../components/brain-history.js';
import { RunShow } from '../components/run-show.js';
import { BrainShow } from '../components/brain-show.js';
import { BrainRerun } from '../components/brain-rerun.js';
import { BrainKill } from '../components/brain-kill.js';
import { BrainRun } from '../components/brain-run.js';
import { BrainResolver } from '../components/brain-resolver.js';
import { BrainWatchWithResolver } from '../components/brain-watch.js';
import { ErrorComponent } from '../components/error.js';

interface BrainListArgs {}
interface BrainHistoryArgs {
  brain: string;
  limit: number;
}
interface BrainShowArgs {
  brain?: string;
  runId?: string;
  steps?: boolean;
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
    return React.createElement(BrainResolver, {
      identifier: brain,
      children: (resolvedBrainTitle: string) =>
        React.createElement(BrainHistory, { brainName: resolvedBrainTitle, limit }),
    });
  }

  show({
    brain,
    runId,
    steps,
  }: ArgumentsCamelCase<BrainShowArgs>): React.ReactElement {
    // If run ID is provided, show run info (existing behavior)
    if (runId) {
      return React.createElement(RunShow, { runId });
    }

    // If brain identifier is provided, show brain info
    if (brain) {
      return React.createElement(BrainShow, { identifier: brain, showSteps: steps || false });
    }

    // Neither provided - show error
    return React.createElement(ErrorComponent, {
      error: {
        title: 'Missing Argument',
        message: 'You must provide either a brain identifier or a run ID.',
        details: 'Use: show <brain> to show brain info, or show --run-id <id> to show run info.',
      },
    });
  }

  rerun({
    brain,
    runId,
    startsAt,
    stopsAfter,
  }: ArgumentsCamelCase<BrainRerunArgs>): React.ReactElement {
    return React.createElement(BrainResolver, {
      identifier: brain,
      children: (resolvedBrainTitle: string) =>
        React.createElement(BrainRerun, {
          identifier: resolvedBrainTitle,
          runId,
          startsAt,
          stopsAfter,
        }),
    });
  }

  run({ brain, watch, options }: ArgumentsCamelCase<BrainRunArgs>): React.ReactElement {
    return React.createElement(BrainRun, {
      identifier: brain,
      watch,
      options,
    });
  }

  watch({
    runId,
    brain,
  }: ArgumentsCamelCase<BrainWatchArgs>): React.ReactElement {
    // If a specific run ID is provided, return the Watch component
    if (runId) {
      return React.createElement(Watch, { runId });
    }

    // If watching by brain identifier is requested, use BrainWatchWithResolver
    // which handles fuzzy search, disambiguation, and active run lookup
    if (brain) {
      return React.createElement(BrainWatchWithResolver, { identifier: brain });
    }

    // Neither runId nor brainName provided – return an error element.
    return React.createElement(
      ErrorComponent,
      {
        error: {
          title: 'Missing Argument',
          message: 'You must provide either a brain run ID or a brain identifier.',
          details: 'Use --run-id to watch a specific run, or --brain to watch the active run of a brain.',
        },
      }
    );
  }

  kill({
    runId,
    force,
  }: ArgumentsCamelCase<BrainKillArgs>): React.ReactElement {
    return React.createElement(BrainKill, { runId, force });
  }

}
