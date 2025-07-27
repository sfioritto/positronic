import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { ScheduleCreate } from '../components/schedule-create.js';
import { ScheduleList } from '../components/schedule-list.js';
import { ScheduleDelete } from '../components/schedule-delete.js';
import { ScheduleRuns } from '../components/schedule-runs.js';

interface ScheduleCreateArgs {
  brainFilename: string;
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

export class ScheduleCommand {
  constructor() {}

  create({
    brainFilename,
    cronExpression,
  }: ArgumentsCamelCase<ScheduleCreateArgs>): React.ReactElement {
    return React.createElement(ScheduleCreate, {
      brainFilename,
      cronExpression,
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
}
