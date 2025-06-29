import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { render } from 'ink';
import { ScheduleCreate } from '../components/schedule-create.js';
import { ScheduleList } from '../components/schedule-list.js';
import { ScheduleDelete } from '../components/schedule-delete.js';

interface ScheduleCreateArgs {
  brainName: string;
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

  async create({
    brainName,
    cronExpression,
  }: ArgumentsCamelCase<ScheduleCreateArgs>) {
    const { waitUntilExit } = render(
      React.createElement(ScheduleCreate, {
        brainName,
        cronExpression,
      })
    );

    await waitUntilExit();
  }

  async list({ brain }: ArgumentsCamelCase<ScheduleListArgs>) {
    const { waitUntilExit } = render(
      React.createElement(ScheduleList, {
        brainFilter: brain,
      })
    );

    await waitUntilExit();
  }

  async delete({ scheduleId, force }: ArgumentsCamelCase<ScheduleDeleteArgs>) {
    const { waitUntilExit } = render(
      React.createElement(ScheduleDelete, {
        scheduleId,
        force,
      })
    );

    await waitUntilExit();
  }

  async runs({
    scheduleId,
    limit,
    status,
  }: ArgumentsCamelCase<ScheduleRunsArgs>) {
    // TODO: Implement runs
    console.log('TODO: List scheduled runs', scheduleId, limit, status);
  }
}
