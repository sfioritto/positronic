import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { BrainList } from '../components/brain-list.js';
import { BrainHistory } from '../components/brain-history.js';
import { RunShow } from '../components/run-show.js';
import { BrainShow } from '../components/brain-show.js';
import { BrainRerun } from '../components/brain-rerun.js';
import { BrainKill } from '../components/brain-kill.js';
import { BrainRun } from '../components/brain-run.js';
import { BrainResolver } from '../components/brain-resolver.js';
import { WatchResolver } from '../components/watch-resolver.js';
import { BrainTop } from '../components/brain-top.js';
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
  identifier: string;
}
interface BrainKillArgs {
  runId: string;
  force: boolean;
}
interface BrainTopArgs {
  brain?: string;
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
    identifier,
  }: ArgumentsCamelCase<BrainWatchArgs>): React.ReactElement {
    return React.createElement(WatchResolver, { identifier });
  }

  kill({
    runId,
    force,
  }: ArgumentsCamelCase<BrainKillArgs>): React.ReactElement {
    return React.createElement(BrainKill, { runId, force });
  }

  top({ brain }: ArgumentsCamelCase<BrainTopArgs>): React.ReactElement {
    return React.createElement(BrainTop, { brainFilter: brain });
  }
}
