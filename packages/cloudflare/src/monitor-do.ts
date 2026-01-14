import { DurableObject } from 'cloudflare:workers';
import {
  BRAIN_EVENTS,
  STATUS,
  createBrainExecutionMachine,
  sendEvent as sendMachineEvent,
} from '@positronic/core';
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
      CREATE TABLE IF NOT EXISTS brain_runs (
        run_id TEXT PRIMARY KEY,
        brain_title TEXT NOT NULL,
        brain_description TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        options TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS brain_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_brain_events_run
      ON brain_events(run_id, id);

      CREATE INDEX IF NOT EXISTS idx_brain_status -- Renamed index
      ON brain_runs(brain_title, status);

      CREATE INDEX IF NOT EXISTS idx_brain_time -- Renamed index
      ON brain_runs(created_at DESC);

      CREATE TABLE IF NOT EXISTS webhook_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        identifier TEXT NOT NULL,
        brain_run_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_lookup
      ON webhook_registrations(slug, identifier);

      CREATE INDEX IF NOT EXISTS idx_webhook_brain_run
      ON webhook_registrations(brain_run_id);

      CREATE TABLE IF NOT EXISTS page_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        brain_run_id TEXT NOT NULL,
        persist INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_page_brain_run
      ON page_registrations(brain_run_id);

      CREATE INDEX IF NOT EXISTS idx_page_persist
      ON page_registrations(persist);
    `);
  }

  handleBrainEvent(event: BrainEvent<any>) {
    if (
      event.type === BRAIN_EVENTS.START ||
      event.type === BRAIN_EVENTS.RESTART ||
      event.type === BRAIN_EVENTS.COMPLETE ||
      event.type === BRAIN_EVENTS.ERROR ||
      event.type === BRAIN_EVENTS.CANCELLED
    ) {
      const { brainRunId } = event;
      const currentTime = Date.now();

      // Store the event in the event stream (append-only)
      this.storage.exec(
        `INSERT INTO brain_events (run_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`,
        brainRunId,
        event.type,
        JSON.stringify(event),
        currentTime
      );

      // Load all events for this brain run and replay through state machine
      const storedEvents = this.storage
        .exec(
          `SELECT event_type, event_data FROM brain_events WHERE run_id = ? ORDER BY id`,
          brainRunId
        )
        .toArray() as Array<{ event_type: string; event_data: string }>;

      // Create fresh state machine and replay all events
      const machine = createBrainExecutionMachine();
      for (const { event_data } of storedEvents) {
        const parsedEvent = JSON.parse(event_data);
        sendMachineEvent(machine, parsedEvent);
      }

      // Use the state machine's computed status (depth-aware)
      const { status } = machine.context;

      const startTime =
        event.type === BRAIN_EVENTS.START || event.type === BRAIN_EVENTS.RESTART
          ? currentTime
          : null;

      // Only set completedAt when status is terminal
      const isTerminalStatus =
        status === STATUS.COMPLETE ||
        status === STATUS.ERROR ||
        status === STATUS.CANCELLED;
      const completeTime = isTerminalStatus ? currentTime : null;

      const error =
        event.type === BRAIN_EVENTS.ERROR ? JSON.stringify(event.error) : null;

      // Update the brain_runs summary table
      this.storage.exec(
        `
        INSERT INTO brain_runs (
          run_id, brain_title, brain_description, type, status,
          options, error, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          error = excluded.error,
          completed_at = excluded.completed_at
      `,
        brainRunId,
        event.brainTitle,
        event.brainDescription || null,
        event.type,
        status,
        JSON.stringify(event.options || {}),
        error,
        currentTime,
        startTime,
        completeTime
      );

      // Clean up registrations when brain terminates
      if (isTerminalStatus) {
        this.clearWebhookRegistrations(brainRunId);
        // Note: Non-persistent page cleanup is handled by PageAdapter which has access to R2
        // We just track pages here, actual R2 deletion happens in the adapter
      }

      this.broadcastRunningBrains();
    }
  }

  private async broadcastRunningBrains() {
    const runningBrains = await this.storage
      .exec(
        `
      SELECT
        run_id as brainRunId,
        brain_title as brainTitle,
        brain_description as brainDescription,
        type,
        status,
        options,
        error,
        created_at as createdAt,
        started_at as startedAt,
        completed_at as completedAt
      FROM brain_runs
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
      // Capture the controller so we can properly unsubscribe on cancel.
      // The cancel callback receives a "reason" parameter, not the controller.
      let streamController: ReadableStreamDefaultController | null = null;

      const stream = new ReadableStream({
        start: async (controller) => {
          streamController = controller;
          try {
            const runningBrains = await this.storage
              .exec(
                `
              SELECT
                run_id as brainRunId,
                brain_title as brainTitle,
                brain_description as brainDescription,
                type,
                status,
                options,
                error,
                created_at as createdAt,
                started_at as startedAt,
                completed_at as completedAt
              FROM brain_runs
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
        cancel: () => {
          if (streamController) {
            this.eventStreamHandler.unsubscribe(streamController);
          }
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

  getLastEvent(brainRunId: string) {
    const results = this.storage
      .exec(
        `
      SELECT * FROM brain_runs WHERE run_id = ?
    `,
        brainRunId
      )
      .toArray();

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get detailed information about a specific brain run
   * Returns null if run not found
   */
  getRun(brainRunId: string) {
    const results = this.storage
      .exec(
        `
      SELECT
        run_id as brainRunId,
        brain_title as brainTitle,
        brain_description as brainDescription,
        type,
        status,
        options,
        error,
        created_at as createdAt,
        started_at as startedAt,
        completed_at as completedAt
      FROM brain_runs
      WHERE run_id = ?
    `,
        brainRunId
      )
      .toArray();

    if (results.length === 0) {
      return null;
    }

    const run = results[0] as any;

    // Parse JSON fields
    return {
      ...run,
      options: run.options ? JSON.parse(run.options) : null,
      error: run.error ? JSON.parse(run.error) : null,
    };
  }

  // Update history method parameter and query
  history(brainTitle: string, limit: number = 10) {
    // Renamed parameter
    // Update select query with aliases and filter by brain_title
    return this.storage
      .exec(
        `
      SELECT
        run_id as brainRunId,
        brain_title as brainTitle,
        brain_description as brainDescription,
        type,
        status,
        options,
        error,
        created_at as createdAt,
        started_at as startedAt,
        completed_at as completedAt
      FROM brain_runs
      WHERE brain_title = ? -- Filter by new column name
      ORDER BY created_at DESC
      LIMIT ?
    `,
        brainTitle,
        limit
      )
      .toArray(); // Use renamed parameter
  }

  // Get active/running brain runs for a specific brain
  activeRuns(brainTitle: string) {
    return this.storage
      .exec(
        `
      SELECT
        run_id as brainRunId,
        brain_title as brainTitle,
        brain_description as brainDescription,
        type,
        status,
        options,
        error,
        created_at as createdAt,
        started_at as startedAt,
        completed_at as completedAt
      FROM brain_runs
      WHERE brain_title = ? AND status = ?
      ORDER BY created_at DESC
    `,
        brainTitle,
        STATUS.RUNNING
      )
      .toArray();
  }

  /**
   * Register a webhook to wait for
   * Called when a brain emits a WEBHOOK event
   */
  registerWebhook(slug: string, identifier: string, brainRunId: string) {
    this.storage.exec(
      `
      INSERT INTO webhook_registrations (slug, identifier, brain_run_id, created_at)
      VALUES (?, ?, ?, ?)
    `,
      slug,
      identifier,
      brainRunId,
      Date.now()
    );
  }

  /**
   * Find a brain waiting for this webhook
   * Returns the brain_run_id if found, null otherwise
   */
  findWaitingBrain(slug: string, identifier: string): string | null {
    const results = this.storage
      .exec(
        `
      SELECT brain_run_id as brainRunId
      FROM webhook_registrations
      WHERE slug = ? AND identifier = ?
      LIMIT 1
    `,
        slug,
        identifier
      )
      .toArray();

    return results.length > 0 ? (results[0] as any).brainRunId : null;
  }

  /**
   * Clear all webhook registrations for a brain run
   * Called when brain completes, errors, or is cancelled
   */
  clearWebhookRegistrations(brainRunId: string) {
    this.storage.exec(
      `
      DELETE FROM webhook_registrations
      WHERE brain_run_id = ?
    `,
      brainRunId
    );
  }

  /**
   * Register a page for tracking
   * Called when a page is created via the API
   */
  registerPage(slug: string, brainRunId: string, persist: boolean) {
    this.storage.exec(
      `
      INSERT INTO page_registrations (slug, brain_run_id, persist, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        brain_run_id = excluded.brain_run_id,
        persist = excluded.persist
    `,
      slug,
      brainRunId,
      persist ? 1 : 0,
      Date.now()
    );
  }

  /**
   * Unregister a page (when deleted via API)
   */
  unregisterPage(slug: string) {
    this.storage.exec(
      `
      DELETE FROM page_registrations
      WHERE slug = ?
    `,
      slug
    );
  }

  /**
   * Get all non-persistent page slugs for a brain run
   * Used by PageAdapter to clean up pages when brain terminates
   */
  getNonPersistentPagesForRun(brainRunId: string): string[] {
    const results = this.storage
      .exec(
        `
      SELECT slug
      FROM page_registrations
      WHERE brain_run_id = ? AND persist = 0
    `,
        brainRunId
      )
      .toArray();

    return results.map((r: any) => r.slug);
  }

  /**
   * Clear all page registrations for a brain run
   * Called after pages are cleaned up
   */
  clearPageRegistrations(brainRunId: string) {
    this.storage.exec(
      `
      DELETE FROM page_registrations
      WHERE brain_run_id = ? AND persist = 0
    `,
      brainRunId
    );
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
