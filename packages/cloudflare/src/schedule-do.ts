import { DurableObject } from 'cloudflare:workers';
import { v4 as uuidv4 } from 'uuid';
import { Cron } from 'croner';
import { BRAIN_EVENTS, type BrainEvent } from '@positronic/core';
import type { BrainRunnerDO } from './brain-runner-do.js';

export interface Env {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  IS_TEST?: string;
  NODE_ENV?: string;
}

interface Schedule {
  id: string;
  brainTitle: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  createdAt: number;
  nextRunAt?: number;
  runAsUserName: string;
  options?: Record<string, string>;
}

interface ScheduledRun {
  id: number;
  scheduleId: string;
  brainRunId?: string;
  status: 'triggered' | 'failed' | 'complete';
  ranAt: number;
  completedAt?: number;
  error?: string;
}

const ALARM_INTERVAL = 60 * 1000;

export class ScheduleDO extends DurableObject<Env> {
  private readonly storage: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage.sql;

    // Initialize database schema
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        brain_title TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        next_run_at INTEGER,
        run_as_user_name TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_brain
      ON schedules(brain_title);

      CREATE INDEX IF NOT EXISTS idx_schedules_enabled
      ON schedules(enabled);

      CREATE TABLE IF NOT EXISTS scheduled_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id TEXT NOT NULL,
        brain_run_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('triggered', 'failed', 'complete')),
        ran_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_runs_schedule
      ON scheduled_runs(schedule_id, ran_at DESC);
    `);

    // Migration: add timezone column for existing DOs
    try {
      this.storage.exec(`ALTER TABLE schedules ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'`);
    } catch {
      // Column already exists
    }

    // Migration: add options column for existing DOs
    try {
      this.storage.exec(`ALTER TABLE schedules ADD COLUMN options TEXT`);
    } catch {
      // Column already exists
    }

  }

  async createSchedule(
    brainTitle: string,
    cronExpression: string,
    timezone: string = 'UTC',
    runAsUserName: string,
    options?: Record<string, string>
  ): Promise<Schedule> {
    const id = uuidv4();
    const createdAt = Date.now();
    if (this.env.IS_TEST !== 'true') {
      const alarm = await this.ctx.storage.getAlarm();
      if (!alarm) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL);
      }
    }
    // Note: Cron expression is validated at the API level before calling this method
    // Calculate next run time
    const nextRunAt = this.calculateNextRunTime(cronExpression, createdAt, timezone);

    this.storage.exec(
      `INSERT INTO schedules (id, brain_title, cron_expression, timezone, enabled, created_at, next_run_at, run_as_user_name, options)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      id,
      brainTitle,
      cronExpression,
      timezone,
      createdAt,
      nextRunAt,
      runAsUserName,
      options ? JSON.stringify(options) : null
    );

    return {
      id,
      brainTitle,
      cronExpression,
      timezone,
      enabled: true,
      createdAt,
      nextRunAt,
      runAsUserName,
      options,
    };
  }

  async getSchedule(scheduleId: string): Promise<Schedule | null> {
    const results = this.storage
      .exec(
        `SELECT id, brain_title, cron_expression, timezone, enabled, created_at, next_run_at, run_as_user_name, options
         FROM schedules WHERE id = ?`,
        scheduleId
      )
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const result = results[0];

    return {
      id: result.id as string,
      brainTitle: result.brain_title as string,
      cronExpression: result.cron_expression as string,
      timezone: (result.timezone as string) || 'UTC',
      enabled: result.enabled === 1,
      createdAt: result.created_at as number,
      nextRunAt: result.next_run_at as number | undefined,
      runAsUserName: result.run_as_user_name as string,
      options: result.options ? JSON.parse(result.options as string) : undefined,
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

  /**
   * List all schedules. Pass null for userName to skip ownership filter (root access).
   */
  async listSchedules(userName: string | null = null): Promise<{ schedules: Schedule[]; count: number }> {
    if (this.env.NODE_ENV === 'development') {
      console.log('[ScheduleDO] Checking alarm');
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm) {
        console.log('[ScheduleDO] Deleting alarm');
        await this.ctx.storage.deleteAlarm();
        console.log('[ScheduleDO] Running alarm handler');
        await this.alarm();
      }
    }

    const schedules = this.storage
      .exec(
        `SELECT id, brain_title, cron_expression, timezone, enabled, created_at, next_run_at, run_as_user_name, options
         FROM schedules
         WHERE (? IS NULL OR run_as_user_name = ?)
         ORDER BY created_at DESC`,
        userName,
        userName
      )
      .toArray()
      .map((row) => ({
        id: row.id as string,
        brainTitle: row.brain_title as string,
        cronExpression: row.cron_expression as string,
        timezone: (row.timezone as string) || 'UTC',
        enabled: row.enabled === 1,
        createdAt: row.created_at as number,
        nextRunAt: row.next_run_at as number | undefined,
        runAsUserName: row.run_as_user_name as string,
        options: row.options ? JSON.parse(row.options as string) : undefined,
      }));

    return {
      schedules,
      count: schedules.length,
    };
  }

  /**
   * Get all scheduled runs. Pass null for userName to skip ownership filter (root access).
   * When userName is set, only returns runs for schedules owned by that user.
   */
  async getAllRuns(
    scheduleId?: string,
    limit: number = 100,
    userName: string | null = null
  ): Promise<{ runs: ScheduledRun[]; count: number }> {
    let query = `
      SELECT sr.id, sr.schedule_id, sr.brain_run_id, sr.status, sr.ran_at, sr.completed_at, sr.error
      FROM scheduled_runs sr
      JOIN schedules s ON sr.schedule_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (scheduleId) {
      query += ` AND sr.schedule_id = ?`;
      params.push(scheduleId);
    }

    query += ` AND (? IS NULL OR s.run_as_user_name = ?)`;
    params.push(userName, userName);

    query += ` ORDER BY sr.ran_at DESC LIMIT ?`;
    params.push(limit);

    const runs = this.storage
      .exec(query, ...params)
      .toArray()
      .map((row) => ({
        id: row.id as number,
        scheduleId: row.schedule_id as string,
        brainRunId: row.brain_run_id as string | undefined,
        status: row.status as 'triggered' | 'failed' | 'complete',
        ranAt: row.ran_at as number,
        completedAt: row.completed_at as number | undefined,
        error: row.error as string | undefined,
      }));

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as count
      FROM scheduled_runs sr
      JOIN schedules s ON sr.schedule_id = s.id
      WHERE 1=1
    `;
    const countParams: any[] = [];

    if (scheduleId) {
      countQuery += ` AND sr.schedule_id = ?`;
      countParams.push(scheduleId);
    }

    countQuery += ` AND (? IS NULL OR s.run_as_user_name = ?)`;
    countParams.push(userName, userName);

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
          `SELECT id, brain_title, cron_expression, timezone, run_as_user_name, options
           FROM schedules
           WHERE enabled = 1 AND next_run_at <= ?`,
          now
        )
        .toArray();

      // Process each due schedule
      for (const schedule of dueSchedules) {
        const scheduleId = schedule.id as string;
        const brainTitle = schedule.brain_title as string;
        const cronExpression = schedule.cron_expression as string;
        const runAsUserName = schedule.run_as_user_name as string;
        const options = schedule.options ? JSON.parse(schedule.options as string) : undefined;

        try {
          // Trigger the brain run as the user who created the schedule
          const brainRunId = await this.triggerBrainRun(brainTitle, runAsUserName, options);

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
               VALUES (?, 'failed', ?, ?)`,
            scheduleId,
            now,
            errorMessage
          );

          console.error(
            `[ScheduleDO] Failed to trigger brain ${brainTitle}:`,
            error
          );
        }

        // Calculate and update next run time
        const timezone = (schedule.timezone as string) || 'UTC';
        const nextRunAt = this.calculateNextRunTime(cronExpression, now, timezone);

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
      // Skip in test environment to avoid isolated storage issues
      if (this.env.IS_TEST !== 'true') {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL);
      }
    }
  }

  private async triggerBrainRun(brainTitle: string, runAsUserName: string, options?: Record<string, string>): Promise<string> {
    const brainRunId = uuidv4();
    const namespace = this.env.BRAIN_RUNNER_DO;
    const doId = namespace.idFromName(brainRunId);
    const stub = namespace.get(doId);
    console.log(
      `[ScheduleDO] Triggering brain run ${brainTitle} with id ${brainRunId} as user ${runAsUserName}`
    );
    await stub.start(brainTitle, brainRunId, { name: runAsUserName }, options ? { options } : undefined);

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
    const result = this.storage
      .exec(
        `SELECT id FROM scheduled_runs WHERE brain_run_id = ?`,
        event.brainRunId
      )
      .toArray();

    if (result.length === 0) {
      // This brain run wasn't triggered by a schedule, ignore it
      return;
    }

    const scheduledRun = result[0];

    const completedAt = Date.now();
    const status = event.type === BRAIN_EVENTS.COMPLETE ? 'complete' : 'failed';
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
  }

  private isValidCronExpression(expression: string): boolean {
    try {
      new Cron(expression);
      return true;
    } catch (error) {
      return false;
    }
  }

  private calculateNextRunTime(cronExpression: string, afterTime: number, timezone: string): number {
    const job = new Cron(cronExpression, { timezone });
    const nextDate = job.nextRun(new Date(afterTime));
    return nextDate!.getTime();
  }

  async setProjectTimezone(timezone: string): Promise<void> {
    this.ctx.storage.put('projectTimezone', timezone);
  }

  async getProjectTimezone(): Promise<string> {
    return (await this.ctx.storage.get<string>('projectTimezone')) || 'UTC';
  }
}
