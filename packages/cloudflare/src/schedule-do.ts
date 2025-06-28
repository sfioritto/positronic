import { DurableObject } from 'cloudflare:workers';
import { v4 as uuidv4 } from 'uuid';
import { parseCronExpression, type Cron } from 'cron-schedule';
import { BRAIN_EVENTS, type BrainEvent } from '@positronic/core';
import type { BrainRunnerDO } from './brain-runner-do.js';

export interface Env {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
}

interface Schedule {
  id: string;
  brainName: string;
  cronExpression: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
}

interface ScheduledRun {
  id: number;
  scheduleId: string;
  brainRunId?: string;
  status: 'triggered' | 'error' | 'complete';
  ranAt: number;
  completedAt?: number;
  error?: string;
}

export class ScheduleDO extends DurableObject<Env> {
  private readonly storage: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage.sql;

    // Initialize database schema
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        brain_name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        next_run_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_brain
      ON schedules(brain_name);

      CREATE INDEX IF NOT EXISTS idx_schedules_enabled
      ON schedules(enabled);

      CREATE TABLE IF NOT EXISTS scheduled_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id TEXT NOT NULL,
        brain_run_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('triggered', 'error', 'complete')),
        ran_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_runs_schedule
      ON scheduled_runs(schedule_id, ran_at DESC);
    `);

    // Always ensure the alarm cycle is running
    // Alarms persist across DO evictions, so check if one already exists
    this.ctx.storage.getAlarm().then((existingAlarm) => {
      if (!existingAlarm) {
        console.log('[ScheduleDO] Starting alarm cycle');
        this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
      }
    });
  }

  async createSchedule(
    brainName: string,
    cronExpression: string
  ): Promise<Schedule> {
    const id = uuidv4();
    const createdAt = Date.now();

    // Validate cron expression
    if (!this.isValidCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    // Calculate next run time
    const cron = parseCronExpression(cronExpression);
    const nextRunAt = this.calculateNextRunTime(cron, createdAt);

    this.storage.exec(
      `INSERT INTO schedules (id, brain_name, cron_expression, enabled, created_at, next_run_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      id,
      brainName,
      cronExpression,
      createdAt,
      nextRunAt
    );

    return {
      id,
      brainName,
      cronExpression,
      enabled: true,
      createdAt,
      nextRunAt,
    };
  }

  async getSchedule(scheduleId: string): Promise<Schedule | null> {
    const result = this.storage
      .exec(
        `SELECT id, brain_name, cron_expression, enabled, created_at, next_run_at
         FROM schedules WHERE id = ?`,
        scheduleId
      )
      .one();

    if (!result) {
      return null;
    }

    return {
      id: result.id as string,
      brainName: result.brain_name as string,
      cronExpression: result.cron_expression as string,
      enabled: result.enabled === 1,
      createdAt: result.created_at as number,
      nextRunAt: result.next_run_at as number | undefined,
    };
  }

  async deleteSchedule(scheduleId: string): Promise<boolean> {
    // Check if schedule exists first
    const existing = await this.getSchedule(scheduleId);
    if (!existing) {
      return false;
    }

    this.storage.exec(`DELETE FROM schedules WHERE id = ?`, scheduleId);

    return true;
  }

  async listSchedules(): Promise<{ schedules: Schedule[]; count: number }> {
    const schedules = this.storage
      .exec(
        `SELECT id, brain_name, cron_expression, enabled, created_at, next_run_at
         FROM schedules
         ORDER BY created_at DESC`
      )
      .toArray()
      .map((row) => ({
        id: row.id as string,
        brainName: row.brain_name as string,
        cronExpression: row.cron_expression as string,
        enabled: row.enabled === 1,
        createdAt: row.created_at as number,
        nextRunAt: row.next_run_at as number | undefined,
      }));

    return {
      schedules,
      count: schedules.length,
    };
  }

  async getScheduledRuns(
    scheduleId?: string,
    limit: number = 100
  ): Promise<{ runs: ScheduledRun[]; count: number }> {
    let query = `
      SELECT id, schedule_id, brain_run_id, status, ran_at, completed_at, error
      FROM scheduled_runs
    `;
    const params: any[] = [];

    if (scheduleId) {
      query += ` WHERE schedule_id = ?`;
      params.push(scheduleId);
    }

    query += ` ORDER BY ran_at DESC LIMIT ?`;
    params.push(limit);

    const runs = this.storage
      .exec(query, ...params)
      .toArray()
      .map((row) => ({
        id: row.id as number,
        scheduleId: row.schedule_id as string,
        brainRunId: row.brain_run_id as string | undefined,
        status: row.status as 'triggered' | 'error' | 'complete',
        ranAt: row.ran_at as number,
        completedAt: row.completed_at as number | undefined,
        error: row.error as string | undefined,
      }));

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM scheduled_runs`;
    const countParams: any[] = [];

    if (scheduleId) {
      countQuery += ` WHERE schedule_id = ?`;
      countParams.push(scheduleId);
    }

    const countResult = this.storage.exec(countQuery, ...countParams).one();
    const count = (countResult?.count as number) || 0;

    return { runs, count };
  }

  // Handle the alarm trigger - runs every minute in a perpetual cycle
  async alarm(): Promise<void> {
    try {
      // This alarm runs every minute to check for schedules that need to be executed.
      // Since cron expressions have minute-level granularity at most (e.g., * * * * *),
      // checking every minute ensures we never miss a scheduled run.

      // Get all enabled schedules that are due
      const now = Date.now();
      const dueSchedules = this.storage
        .exec(
          `SELECT id, brain_name, cron_expression
           FROM schedules
           WHERE enabled = 1 AND next_run_at <= ?`,
          now
        )
        .toArray();

      // Process each due schedule
      for (const schedule of dueSchedules) {
        const scheduleId = schedule.id as string;
        const brainName = schedule.brain_name as string;
        const cronExpression = schedule.cron_expression as string;

        try {
          // Trigger the brain run
          const brainRunId = await this.triggerBrainRun(brainName);

          // Record successful run
          this.storage.exec(
            `INSERT INTO scheduled_runs (schedule_id, brain_run_id, status, ran_at)
             VALUES (?, ?, 'triggered', ?)`,
            scheduleId,
            brainRunId,
            now
          );
        } catch (error) {
          // Record failed run
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.storage.exec(
            `INSERT INTO scheduled_runs (schedule_id, status, ran_at, error)
               VALUES (?, 'error', ?, ?)`,
            scheduleId,
            now,
            errorMessage
          );

          console.error(
            `[ScheduleDO] Failed to trigger brain ${brainName}:`,
            error
          );
        }

        // Calculate and update next run time
        const cron = parseCronExpression(cronExpression);
        const nextRunAt = this.calculateNextRunTime(cron, now);
        this.storage.exec(
          `UPDATE schedules SET next_run_at = ? WHERE id = ?`,
          nextRunAt,
          scheduleId
        );
      }
    } finally {
      // Always schedule the next alarm for 1 minute from now
      // This creates a perpetual cycle that checks for due schedules every minute
      // The finally block ensures this happens even if there's an error above
      await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    }
  }

  private async triggerBrainRun(brainName: string): Promise<string> {
    const brainRunId = uuidv4();
    const namespace = this.env.BRAIN_RUNNER_DO;
    const doId = namespace.idFromName(brainRunId);
    const stub = namespace.get(doId);

    await stub.start(brainName, brainRunId);

    return brainRunId;
  }

  // Called by ScheduleAdapter when brain events occur
  async handleBrainEvent(event: BrainEvent<any>): Promise<void> {
    // We only care about completion events for scheduled runs
    if (
      event.type !== BRAIN_EVENTS.COMPLETE &&
      event.type !== BRAIN_EVENTS.ERROR
    ) {
      return;
    }

    // Check if this brain run was triggered by a schedule
    const scheduledRun = this.storage
      .exec(
        `SELECT id FROM scheduled_runs WHERE brain_run_id = ?`,
        event.brainRunId
      )
      .one();

    if (!scheduledRun) {
      // This brain run wasn't triggered by a schedule, ignore it
      return;
    }

    const completedAt = Date.now();
    const status = event.type === BRAIN_EVENTS.COMPLETE ? 'complete' : 'error';
    const error =
      event.type === BRAIN_EVENTS.ERROR
        ? event.error
          ? JSON.stringify(event.error)
          : 'Unknown error'
        : null;

    // Update the scheduled run record
    this.storage.exec(
      `UPDATE scheduled_runs
       SET status = ?, completed_at = ?, error = ?
       WHERE brain_run_id = ?`,
      status,
      completedAt,
      error,
      event.brainRunId
    );

    console.log(
      `[ScheduleDO] Scheduled run ${event.brainRunId} ${status}`,
      error ? `with error: ${error}` : ''
    );
  }

  private isValidCronExpression(expression: string): boolean {
    try {
      // Try to parse the expression - if it throws, it's invalid
      parseCronExpression(expression);
      return true;
    } catch (error) {
      return false;
    }
  }

  private calculateNextRunTime(cron: Cron, afterTime: number): number {
    const nextDate = cron.getNextDate(new Date(afterTime));
    return nextDate.getTime();
  }
}
