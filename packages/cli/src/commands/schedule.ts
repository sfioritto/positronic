import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { ScheduleCreate } from '../components/schedule-create.js';
import { ScheduleList } from '../components/schedule-list.js';
import { ScheduleDelete } from '../components/schedule-delete.js';
import { ScheduleRuns } from '../components/schedule-runs.js';
import { ScheduleTimezone } from '../components/schedule-timezone.js';
import { BrainResolver } from '../components/brain-resolver.js';

interface ScheduleCreateArgs {
  brain: string;
  cronExpression: string;
}

interface ScheduleListArgs {
  brain?: string;
}

interface ScheduleDeleteArgs {
  scheduleId: string;
  force: boolean;
}

interface ScheduleRunsArgs {
  scheduleId?: string;
  limit: number;
  status?: 'triggered' | 'failed' | 'complete';
}

interface ScheduleTimezoneArgs {
  timezone?: string;
}

export class ScheduleCommand {
  constructor() {}

  create({
    brain,
    cronExpression,
  }: ArgumentsCamelCase<ScheduleCreateArgs>): React.ReactElement {
    return React.createElement(BrainResolver, {
      identifier: brain,
      children: (resolvedBrainTitle: string) =>
        React.createElement(ScheduleCreate, {
          identifier: resolvedBrainTitle,
          cronExpression,
        }),
    });
  }

  list({ brain }: ArgumentsCamelCase<ScheduleListArgs>): React.ReactElement {
    return React.createElement(ScheduleList, {
      brainFilter: brain,
    });
  }

  delete({ scheduleId, force }: ArgumentsCamelCase<ScheduleDeleteArgs>): React.ReactElement {
    return React.createElement(ScheduleDelete, {
      scheduleId,
      force,
    });
  }

  runs({
    scheduleId,
    limit,
    status,
  }: ArgumentsCamelCase<ScheduleRunsArgs>): React.ReactElement {
    return React.createElement(ScheduleRuns, {
      scheduleId,
      limit,
      status,
    });
  }

  timezone({
    timezone,
  }: ArgumentsCamelCase<ScheduleTimezoneArgs>): React.ReactElement {
    return React.createElement(ScheduleTimezone, {
      timezone,
    });
  }
}
