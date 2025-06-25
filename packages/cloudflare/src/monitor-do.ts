import { DurableObject } from 'cloudflare:workers';
import { BRAIN_EVENTS, STATUS } from '@positronic/core';
import type { BrainEvent } from '@positronic/core';

export interface Env {
  // Add any environment bindings here as needed
}

export class MonitorDO extends DurableObject<Env> {
  private readonly storage: SqlStorage;
  private eventStreamHandler = new EventStreamHandler();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.storage = state.storage.sql;

    // Update table schema and indexes
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        run_id TEXT PRIMARY KEY,
        brain_title TEXT NOT NULL, -- Renamed column
        brain_description TEXT, -- Renamed column
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        options TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_brain_status -- Renamed index
      ON workflow_runs(brain_title, status);

      CREATE INDEX IF NOT EXISTS idx_brain_time -- Renamed index
      ON workflow_runs(created_at DESC);
    `);
  }

  handleBrainEvent(event: BrainEvent<any>) {
    if (
      event.type === BRAIN_EVENTS.START ||
      event.type === BRAIN_EVENTS.RESTART ||
      event.type === BRAIN_EVENTS.COMPLETE ||
      event.type === BRAIN_EVENTS.ERROR
    ) {
      const currentTime = Date.now();
      const startTime =
        event.type === BRAIN_EVENTS.START || event.type === BRAIN_EVENTS.RESTART
          ? currentTime
          : null;
      const completeTime =
        event.type === BRAIN_EVENTS.COMPLETE ||
        event.type === BRAIN_EVENTS.ERROR
          ? currentTime
          : null;
      const error =
        event.type === BRAIN_EVENTS.ERROR ? JSON.stringify(event.error) : null;

      // Update SQL insert/update with new column names, read from existing event fields
      this.storage.exec(
        `
        INSERT INTO workflow_runs (
          run_id, brain_title, brain_description, type, status,
          options, error, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          error = excluded.error,
          completed_at = excluded.completed_at
      `,
        event.workflowRunId, // Use workflowRunId for run_id
        event.workflowTitle, // Read from event field, store in brain_title
        event.workflowDescription || null, // Read from event field, store in brain_description
        event.type,
        event.status,
        JSON.stringify(event.options || {}),
        error,
        currentTime,
        startTime,
        completeTime
      );

      this.broadcastRunningBrains();
    }
  }

  private async broadcastRunningBrains() {
    const runningBrains = await this.storage
      .exec(
        `
      SELECT
        run_id as workflowRunId,
        brain_title as workflowTitle,
        brain_description as workflowDescription,
        type,
        status,
        options,
        error,
        created_at as createdAt,
        started_at as startedAt,
        completed_at as completedAt
      FROM workflow_runs
      WHERE status = ?
      ORDER BY created_at DESC
    `,
        STATUS.RUNNING
      )
      .toArray();

    this.eventStreamHandler.broadcast({ runningBrains });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const encoder = new TextEncoder();

    if (url.pathname === '/watch') {
      const stream = new ReadableStream({
        start: async (controller) => {
          try {
            const runningBrains = await this.storage
              .exec(
                `
              SELECT
                run_id as workflowRunId,
                brain_title as workflowTitle,
                brain_description as workflowDescription,
                type,
                status,
                options,
                error,
                created_at as createdAt,
                started_at as startedAt,
                completed_at as completedAt
              FROM workflow_runs
              WHERE status = ?
              ORDER BY created_at DESC
            `,
                STATUS.RUNNING
              )
              .toArray();

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ runningBrains })}\n\n`)
            );

            this.eventStreamHandler.subscribe(controller);
          } catch (err) {
            console.error('[MONITOR_DO] Error during stream start:', err);
            controller.close();
            this.eventStreamHandler.unsubscribe(controller);
          }
        },
        cancel: (controller) => {
          this.eventStreamHandler.unsubscribe(controller);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // No changes needed for getLastEvent, uses run_id
  getLastEvent(workflowRunId: string) {
    return this.storage
      .exec(
        `
      SELECT * FROM workflow_runs WHERE run_id = ?
    `,
        workflowRunId
      )
      .one();
  }

  // Update history method parameter and query
  history(brainTitle: string, limit: number = 10) {
    // Renamed parameter
    // Update select query with aliases and filter by brain_title
    return this.storage
      .exec(
        `
      SELECT
        run_id as workflowRunId,
        brain_title as brainTitle,
        brain_description as brainDescription,
        type,
        status,
        options,
        error,
        created_at as createdAt,
        started_at as startedAt,
        completed_at as completedAt
      FROM workflow_runs
      WHERE brain_title = ? -- Filter by new column name
      ORDER BY created_at DESC
      LIMIT ?
    `,
        brainTitle,
        limit
      )
      .toArray(); // Use renamed parameter
  }
}

class EventStreamHandler {
  private subscribers: Set<ReadableStreamDefaultController> = new Set();
  private encoder = new TextEncoder();

  subscribe(controller: ReadableStreamDefaultController) {
    this.subscribers.add(controller);
  }

  unsubscribe(controller: ReadableStreamDefaultController) {
    this.subscribers.delete(controller);
  }

  broadcast(data: any) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encodedMessage = this.encoder.encode(message);
    this.subscribers.forEach((controller) => {
      try {
        controller.enqueue(encodedMessage);
      } catch (e) {
        console.error(
          '[MONITOR_DO_SSE] Failed to send message to subscriber, removing.',
          e
        );
        this.unsubscribe(controller);
      }
    });
  }
}
