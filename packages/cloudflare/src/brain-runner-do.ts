import {
  BrainRunner,
  type Resources,
  type ObjectGenerator,
  STATUS,
  BRAIN_EVENTS,
  type RuntimeEnv,
  createBrainExecutionMachine,
  sendEvent,
  type BrainSignal,
} from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';

import type { Adapter, BrainEvent } from '@positronic/core';
import { CloudflareSignalProvider } from './signal-provider.js';
import { BrainRunSQLiteAdapter } from './sqlite-adapter.js';
import { WebhookAdapter } from './webhook-adapter.js';
import { TimeoutAdapter } from './timeout-adapter.js';
import { PageAdapter } from './page-adapter.js';
import { EventLoader } from './event-loader.js';
import { createPagesService } from './pages-service.js';
import { createFiles } from './files-service.js';
import type { MonitorDO } from './monitor-do.js';
import type { ScheduleDO } from './schedule-do.js';
import type { GovernorDO } from './governor-do.js';
import { PositronicManifest } from './manifest.js';
import { setGovernorBinding, rateGoverned } from './governor-client-wrapper.js';
import { CloudflareR2Loader } from './r2-loader.js';
import { createR2Backend } from './create-r2-store.js';
import { createResources, type ResourceManifest } from '@positronic/core';
import { getOrigin } from './origin.js';
import type { R2Bucket } from '@cloudflare/workers-types';

import { v4 as uuidv4 } from 'uuid';

let manifest: PositronicManifest | null = null;
export function setManifest(generatedManifest: PositronicManifest) {
  manifest = generatedManifest;
}

export function getManifest(): PositronicManifest | null {
  return manifest;
}

/**
 * Start a new brain run on a fresh BrainRunnerDO.
 * Shared by the API endpoint, ScheduleDO, and webhook triggers.
 */
export async function startBrainRun(
  namespace: DurableObjectNamespace<BrainRunnerDO>,
  brainTitle: string,
  currentUser: { name: string },
  initialData?: Record<string, any>
): Promise<string> {
  const brainRunId = uuidv4();
  const doId = namespace.idFromName(brainRunId);
  const stub = namespace.get(doId);
  await stub.start(brainTitle, brainRunId, currentUser, initialData);
  return brainRunId;
}

let brainRunner: BrainRunner | null = null;
export function setBrainRunner(runner: BrainRunner) {
  brainRunner = runner;
}

let webhookManifest: Record<string, any> = {};
export function setWebhookManifest(manifest: Record<string, any>) {
  webhookManifest = manifest;
}

export function getWebhookManifest(): Record<string, any> {
  return webhookManifest;
}

export interface Env {
  BRAIN_RUNNER_DO: DurableObjectNamespace;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
  GOVERNOR_DO: DurableObjectNamespace<GovernorDO>;
  RESOURCES_BUCKET: R2Bucket;
}

class EventStreamAdapter implements Adapter {
  private subscribers: Set<ReadableStreamDefaultController> = new Set();
  private encoder = new TextEncoder();

  subscribe(controller: ReadableStreamDefaultController) {
    this.subscribers.add(controller);
  }

  unsubscribe(controller: ReadableStreamDefaultController) {
    this.subscribers.delete(controller);
  }

  private broadcast(event: BrainEvent<any>) {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    const encodedMessage = this.encoder.encode(message);
    this.subscribers.forEach((controller) => {
      try {
        controller.enqueue(encodedMessage);
      } catch (e) {
        console.error(
          '[DO_SSE_ADAPTER] Failed to send message to subscriber, removing.',
          e
        );
        this.unsubscribe(controller);
      }
    });
  }

  async dispatch(event: BrainEvent<any>): Promise<void> {
    try {
      this.broadcast(event);
    } catch (e) {
      console.error('[DO_SSE_ADAPTER] Error dispatching event:', e);
      throw e;
    }
  }
}

class MonitorAdapter implements Adapter {
  constructor(private monitorStub: DurableObjectStub<MonitorDO>) {}

  async dispatch(event: BrainEvent<any>): Promise<void> {
    await this.monitorStub.handleBrainEvent(event);
  }
}

class ScheduleAdapter implements Adapter {
  constructor(private scheduleStub: DurableObjectStub<ScheduleDO>) {}

  async dispatch(event: BrainEvent<any>): Promise<void> {
    await this.scheduleStub.handleBrainEvent(event);
  }
}

/**
 * Adapter that intercepts ITERATE_ITEM_COMPLETE events and triggers a
 * DO alarm-based restart to reclaim memory between items.
 * After each item, it queues a PAUSE signal and sets an immediate alarm.
 * The alarm fires, calls wakeUp(), which replays events, reconstructs
 * iterate progress, and resumes from the next item.
 */
class IterateItemAdapter implements Adapter {
  constructor(
    private doQueueSignal: (signal: { type: string }) => Promise<any>,
    private doSetAlarm: (time: number) => Promise<void>
  ) {}

  async dispatch(event: BrainEvent<any>): Promise<void> {
    if (event.type === BRAIN_EVENTS.ITERATE_ITEM_COMPLETE) {
      // Only pause and restart between items, not after the last item.
      // After the last item the brain continues to subsequent steps naturally.
      // A spurious alarm after the last item would call wakeUp() while the
      // brain is still running, corrupting execution state.
      const { processedCount, totalItems, canRelease } = event as any;
      if (canRelease && processedCount < totalItems) {
        await this.doQueueSignal({ type: 'PAUSE' });
        await this.doSetAlarm(Date.now());
      }
    }
  }
}

// SQL to initialize the run owner table (stores who started this brain run)
const runOwnerTableSQL = `
CREATE TABLE IF NOT EXISTS run_owner (
  user_name TEXT NOT NULL
);
`;

// SQL to initialize the signals table
const signalsTableSQL = `
CREATE TABLE IF NOT EXISTS brain_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_type TEXT NOT NULL,
  content TEXT,
  queued_at INTEGER NOT NULL
);
`;

// SQL to initialize the wait timeout table
const waitTimeoutTableSQL = `
CREATE TABLE IF NOT EXISTS wait_timeout (
  brain_run_id TEXT PRIMARY KEY,
  timeout_at INTEGER NOT NULL
);
`;

export class BrainRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private brainRunId: string;
  private eventStreamAdapter = new EventStreamAdapter();
  private abortController: AbortController | null = null;
  private pageAdapter: PageAdapter | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.brainRunId = state.id.toString();
    this.env = env;

    this.sql.exec(runOwnerTableSQL);
    this.sql.exec(signalsTableSQL);
    this.sql.exec(waitTimeoutTableSQL);
  }

  private storeRunOwner(userName: string) {
    this.sql.exec(`INSERT INTO run_owner (user_name) VALUES (?)`, userName);
  }

  private getRunOwner(): string | null {
    const results = this.sql
      .exec<{ user_name: string }>(`SELECT user_name FROM run_owner LIMIT 1`)
      .toArray();
    return results.length > 0 ? results[0].user_name : null;
  }

  storeWaitTimeout(brainRunId: string, timeoutAt: number) {
    this.sql.exec(
      `INSERT OR REPLACE INTO wait_timeout (brain_run_id, timeout_at) VALUES (?, ?)`,
      brainRunId,
      timeoutAt
    );
  }

  clearWaitTimeout(brainRunId: string) {
    this.sql.exec(
      `DELETE FROM wait_timeout WHERE brain_run_id = ?`,
      brainRunId
    );
  }

  getWaitTimeout(): { brainRunId: string; timeoutAt: number } | null {
    const results = this.sql
      .exec<{ brain_run_id: string; timeout_at: number }>(
        `SELECT brain_run_id, timeout_at FROM wait_timeout LIMIT 1`
      )
      .toArray();
    if (results.length === 0) return null;
    return {
      brainRunId: results[0].brain_run_id,
      timeoutAt: results[0].timeout_at,
    };
  }

  /**
   * Queue a signal for this brain run.
   * Returns the queued signal with timestamp.
   * For WEBHOOK_RESPONSE signals, the response object is JSON-stringified and stored in content.
   */
  async queueSignal(signal: {
    type: string;
    content?: string;
    response?: Record<string, unknown>;
  }): Promise<{ type: string; queuedAt: number }> {
    // For WEBHOOK_RESPONSE, store the response as JSON in the content field
    const content =
      signal.type === 'WEBHOOK_RESPONSE' && signal.response
        ? JSON.stringify(signal.response)
        : signal.content ?? null;

    const queuedAt = Date.now();
    this.sql.exec(
      `INSERT INTO brain_signals (signal_type, content, queued_at) VALUES (?, ?, ?)`,
      signal.type,
      content,
      queuedAt
    );

    return { type: signal.type, queuedAt };
  }

  /**
   * Get and consume (delete) pending signals.
   * Signals are returned in priority order: KILL > PAUSE > WEBHOOK_RESPONSE > RESUME
   * @param filter 'CONTROL' returns only KILL/PAUSE, 'WEBHOOK' returns only WEBHOOK_RESPONSE, 'ALL' includes all signal types
   */
  getAndConsumeSignals(filter: 'CONTROL' | 'WEBHOOK' | 'ALL'): BrainSignal[] {
    // Query signals ordered by priority
    let whereClause = '';
    if (filter === 'CONTROL') {
      whereClause = `WHERE signal_type IN ('KILL', 'PAUSE')`;
    } else if (filter === 'WEBHOOK') {
      whereClause = `WHERE signal_type = 'WEBHOOK_RESPONSE'`;
    }

    const results = this.sql
      .exec<{ id: number; signal_type: string; content: string | null }>(
        `SELECT id, signal_type, content FROM brain_signals ${whereClause}
         ORDER BY CASE signal_type
           WHEN 'KILL' THEN 1
           WHEN 'PAUSE' THEN 2
           WHEN 'WEBHOOK_RESPONSE' THEN 3
           WHEN 'RESUME' THEN 4
         END`
      )
      .toArray();

    if (results.length === 0) {
      return [];
    }

    // Delete the returned signals (consume them)
    const ids = results.map((r) => r.id);
    this.sql.exec(`DELETE FROM brain_signals WHERE id IN (${ids.join(',')})`);

    // Convert to BrainSignal format
    return results.map((r) => {
      if (r.signal_type === 'WEBHOOK_RESPONSE') {
        return {
          type: 'WEBHOOK_RESPONSE' as const,
          response: JSON.parse(r.content ?? '{}'),
        };
      }
      if (r.signal_type === 'RESUME') {
        return { type: 'RESUME' as const };
      }
      return { type: r.signal_type as 'KILL' | 'PAUSE' };
    });
  }

  private async loadResourcesFromR2(): Promise<Resources | null> {
    const bucket = this.env.RESOURCES_BUCKET;

    // List all resources in R2
    const listed = await bucket.list();
    // Check if results are truncated
    if (listed.truncated) {
      throw new Error(
        `Too many resources in R2 bucket (more than 1000). ` +
          `Resource pagination is not yet supported. ` +
          `Please reduce the number of resources.`
      );
    }

    if (listed.objects.length === 0) {
      return null;
    }

    // Build the manifest structure
    const manifest: ResourceManifest = {};
    let resourceCount = 0;

    for (const object of listed.objects) {
      // Get object metadata
      const r2Object = await bucket.head(object.key);

      if (!r2Object || !r2Object.customMetadata?.type) {
        // Skip non-resource objects (e.g., pages, or other data stored in the bucket)
        continue;
      }

      // Parse the key to create nested structure
      // e.g., "folder/file.txt" becomes manifest.folder["file.txt"]
      const keyParts = object.key.split('/');

      // Get the file name (with extension preserved)
      const fileName = keyParts[keyParts.length - 1];

      // Navigate/create nested structure
      let current: any = manifest;
      for (let i = 0; i < keyParts.length - 1; i++) {
        const part = keyParts[i];
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }

      // Add the resource entry with full filename
      current[fileName] = {
        type: r2Object.customMetadata.type as 'text' | 'binary',
        key: object.key,
        path: r2Object.customMetadata.path || object.key,
      };

      resourceCount++;
    }

    if (resourceCount === 0) {
      return null;
    }

    // Create the loader and resources
    const loader = new CloudflareR2Loader(bucket);
    const resources = createResources(loader, manifest);

    return resources;
  }

  /**
   * Build the RuntimeEnv for brain execution.
   * Extracts secrets from Cloudflare env bindings (string values only).
   */
  private async buildRuntimeEnv(): Promise<RuntimeEnv> {
    // Extract secrets: filter this.env to only string values
    // This automatically excludes infrastructure bindings (R2Bucket, DurableObjectNamespace are objects)
    const secrets: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (typeof value === 'string') {
        secrets[key] = value;
      }
    }

    const origin = await getOrigin(this.env.RESOURCES_BUCKET);

    return {
      origin,
      // Cast to Secrets - the generated secrets.d.ts augments Secrets with specific keys
      secrets: secrets as unknown as RuntimeEnv['secrets'],
    };
  }

  /**
   * Kill a brain run. This method handles multiple scenarios:
   * 1. Brain is actively running (has abortController) - abort it
   * 2. Brain is suspended (waiting for webhook) - emit CANCELLED event
   * 3. Brain is a "zombie" (DO state missing due to IoContext timeout) - directly update MonitorDO
   *
   * The brainRunId and brainTitle parameters are used as fallbacks when the DO's
   * SQLite state is missing (zombie brain scenario).
   */
  async kill(
    brainRunId?: string,
    brainTitle?: string
  ): Promise<{ success: boolean; message: string }> {
    // If brain is actively running, abort it
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
      return { success: true, message: 'Brain run kill signal sent' };
    }

    const monitorStub = this.env.MONITOR_DO.get(
      this.env.MONITOR_DO.idFromName('singleton')
    );

    // Use passed-in brainRunId/brainTitle if provided (from API which already verified the run exists)
    // Only fall back to SQLite if not provided
    let actualBrainRunId = brainRunId;
    let actualBrainTitle = brainTitle;
    let startEvent: any = null;

    // Only query SQLite if we don't have the brainRunId from the API
    if (!actualBrainRunId) {
      try {
        // Use EventLoader to handle R2 overflow transparently
        const eventLoader = new EventLoader(
          this.sql,
          this.env.RESOURCES_BUCKET
        );
        startEvent = await eventLoader.loadEventByType(
          BRAIN_EVENTS.START,
          'DESC'
        );

        if (startEvent) {
          actualBrainRunId = startEvent.brainRunId;
          actualBrainTitle = startEvent.brainTitle;
        }
      } catch (err) {
        // Table doesn't exist - brain was killed before any events were written to DO's SQLite
        console.log(
          `[DO ${this.brainRunId}] kill() could not query brain_events (table may not exist)`
        );
      }
    }

    // If we still don't have a brainRunId, we can't proceed
    if (!actualBrainRunId) {
      return {
        success: false,
        message: 'Brain run not found or never started',
      };
    }

    // Check MonitorDO status
    const existingRun = await monitorStub.getLastEvent(actualBrainRunId);
    if (!existingRun) {
      return { success: false, message: 'Brain run not found in monitor' };
    }

    // If already completed/cancelled/errored, nothing to do
    // Active statuses that can be killed: RUNNING, PAUSED, WAITING
    const activeStatuses: string[] = [
      STATUS.RUNNING,
      STATUS.PAUSED,
      STATUS.WAITING,
    ];
    if (!activeStatuses.includes(existingRun.status as string)) {
      return {
        success: false,
        message: 'Brain run is not active or already completed',
      };
    }

    // Emit CANCELLED event
    const cancelledEvent: BrainEvent<any> = {
      type: BRAIN_EVENTS.CANCELLED,
      status: STATUS.CANCELLED,
      brainTitle:
        actualBrainTitle || String(existingRun.brain_title) || 'unknown',
      brainDescription: startEvent?.brainDescription || '',
      brainRunId: actualBrainRunId,
      options: startEvent?.options || {},
    };

    // Clean up any pending wait timeout and alarm to prevent spurious
    // alarm fires after the brain has been manually cancelled.
    const pendingTimeout = this.getWaitTimeout();
    if (pendingTimeout) {
      this.clearWaitTimeout(pendingTimeout.brainRunId);
      await this.ctx.storage.deleteAlarm();
    }

    // Dispatch to PageAdapter for cleanup (deletes non-persistent pages from R2)
    // This is needed because when a brain is paused (waiting for webhook), the BrainRunner
    // has already returned and adapters aren't receiving events through the normal pipeline.
    // For zombie brains (server restarted), pageAdapter may be null, so we create one on the fly.
    const pageAdapter =
      this.pageAdapter ??
      new PageAdapter(monitorStub, this.env.RESOURCES_BUCKET);
    await pageAdapter.dispatch(cancelledEvent);

    await monitorStub.handleBrainEvent(cancelledEvent);

    return { success: true, message: 'Brain run cancelled' };
  }

  /**
   * Destructive rerun: truncate event history to just before step N,
   * then resume from there using the existing wakeUp() machinery.
   * startsAt is 1-indexed: --starts-at 3 keeps steps 1-2, re-executes from step 3.
   */
  async rerun(startsAt: number) {
    if (this.abortController) {
      throw new Error('Cannot rerun while brain is actively running');
    }

    const eventLoader = new EventLoader(this.sql, this.env.RESOURCES_BUCKET);
    const eventsWithIds = await eventLoader.loadAllEventsWithIds();

    if (eventsWithIds.length === 0) {
      throw new Error('No events found for this brain run');
    }

    // Find the START event to get initialState
    const startEntry = eventsWithIds.find(
      (e) => e.event.type === BRAIN_EVENTS.START
    );
    if (!startEntry) {
      throw new Error('No START event found');
    }

    const initialState = (startEntry.event as any).initialState || {};

    // Replay events through a state machine and count top-level STEP_COMPLETE events
    const machine = createBrainExecutionMachine({ initialState });
    const stepsToKeep = startsAt - 1;
    let topLevelStepCount = 0;
    let cutoffEventId = startEntry.eventId; // Default: keep only START

    for (const { eventId, event } of eventsWithIds) {
      sendEvent(machine, event);

      if (
        event.type === BRAIN_EVENTS.STEP_COMPLETE &&
        machine.context.isTopLevel
      ) {
        topLevelStepCount++;
        if (topLevelStepCount === stepsToKeep) {
          cutoffEventId = eventId;
          break;
        }
      }
    }

    // If startsAt is 1, cutoff stays at the START event's ID

    // Find R2 keys that need to be deleted (overflow events beyond the cutoff)
    const r2Rows = this.sql
      .exec<{ r2_key: string }>(
        `SELECT r2_key FROM brain_events WHERE event_id > ? AND r2_key IS NOT NULL`,
        cutoffEventId
      )
      .toArray();

    // Delete R2 objects
    if (r2Rows.length > 0) {
      await Promise.all(
        r2Rows.map((row) => this.env.RESOURCES_BUCKET.delete(row.r2_key))
      );
    }

    // Truncate events beyond cutoff
    this.sql.exec(`DELETE FROM brain_events WHERE event_id > ?`, cutoffEventId);

    // Clear signals and wait timeouts
    this.sql.exec(`DELETE FROM brain_signals`);
    this.sql.exec(`DELETE FROM wait_timeout`);

    // Cancel any pending alarm
    await this.ctx.storage.deleteAlarm();

    // Resume from the truncation point
    await this.wakeUp(this.brainRunId);
  }

  async alarm() {
    const timeout = this.getWaitTimeout();
    if (timeout && Date.now() >= timeout.timeoutAt) {
      this.clearWaitTimeout(timeout.brainRunId);
      await this.queueSignal({ type: 'KILL' });
    }
    await this.wakeUp(this.brainRunId);
  }

  /**
   * Resolve a brain from the manifest, create all adapters and the configured
   * BrainRunner. Shared setup for both start() and wakeUp().
   */
  private async prepareRunner(
    brainTitle: string,
    brainRunId: string,
    currentUser: { name: string }
  ) {
    if (!manifest) {
      throw new Error('Runtime manifest not initialized');
    }

    const resolution = manifest.resolve(brainTitle);
    if (resolution.matchType === 'none') {
      console.error(
        `[DO ${brainRunId}] Brain ${brainTitle} not found in manifest.`
      );
      throw new Error(`Brain ${brainTitle} not found`);
    }

    if (resolution.matchType === 'multiple') {
      console.error(
        `[DO ${brainRunId}] Multiple brains match identifier ${brainTitle}`,
        resolution.candidates
      );
      throw new Error(`Multiple brains match identifier ${brainTitle}`);
    }

    const brainToRun = resolution.brain;
    if (!brainToRun) {
      throw new Error(
        `Brain ${brainTitle} resolved but brain object is missing`
      );
    }

    const sqliteAdapter = new BrainRunSQLiteAdapter(
      this.sql,
      this.env.RESOURCES_BUCKET,
      brainRunId
    );
    const monitorDOStub = this.env.MONITOR_DO.get(
      this.env.MONITOR_DO.idFromName('singleton')
    );
    const monitorAdapter = new MonitorAdapter(monitorDOStub);
    const scheduleAdapter = new ScheduleAdapter(
      this.env.SCHEDULE_DO.get(this.env.SCHEDULE_DO.idFromName('singleton'))
    );
    const webhookAdapter = new WebhookAdapter(monitorDOStub);
    this.pageAdapter = new PageAdapter(
      monitorDOStub,
      this.env.RESOURCES_BUCKET
    );

    const env = await this.buildRuntimeEnv();
    const pagesService = createPagesService(
      brainRunId,
      this.env.RESOURCES_BUCKET,
      monitorDOStub,
      env
    );
    const files = createFiles(
      this.env.RESOURCES_BUCKET,
      brainTitle,
      brainRunId,
      currentUser,
      env
    );

    setGovernorBinding(this.env.GOVERNOR_DO);

    if (!brainRunner) {
      throw new Error('BrainRunner not initialized');
    }

    const r2Resources = await this.loadResourcesFromR2();

    const signalProvider = new CloudflareSignalProvider((filter) =>
      this.getAndConsumeSignals(filter)
    );

    const bucket = this.env.RESOURCES_BUCKET;
    const storeBackend = createR2Backend(bucket);

    this.abortController = new AbortController();

    const iterateItemAdapter = new IterateItemAdapter(
      (signal) => this.queueSignal(signal),
      (time) => this.ctx.storage.setAlarm(time)
    );

    const timeoutAdapter = new TimeoutAdapter(
      (brainRunId, timeoutAt) => this.storeWaitTimeout(brainRunId, timeoutAt),
      (time) => this.ctx.storage.setAlarm(time)
    );

    const runner = new BrainRunner({
      client: brainRunner.client,
      adapters: [
        sqliteAdapter,
        this.eventStreamAdapter,
        monitorAdapter,
        scheduleAdapter,
        webhookAdapter,
        this.pageAdapter,
        iterateItemAdapter,
        timeoutAdapter,
      ],
      env,
      resources: r2Resources ?? {},
      signalProvider,
      governor: (c: ObjectGenerator) => rateGoverned(c),
      files: files,
      pages: pagesService,
      storeProvider: storeBackend,
    });

    return { brainToRun, runner };
  }

  async start(
    brainTitle: string,
    brainRunId: string,
    currentUser: { name: string },
    initialData?: Record<string, any>
  ) {
    // Extract options and initialState from initialData if present
    const options = initialData?.options;
    const initialState =
      initialData?.initialState ??
      (initialData && !initialData.options && !initialData.initialState
        ? initialData
        : {});

    // Persist run owner durably (immutable, not derived from events)
    this.storeRunOwner(currentUser.name);

    const { brainToRun, runner } = await this.prepareRunner(
      brainTitle,
      brainRunId,
      currentUser
    );

    runner
      .run(brainToRun, {
        currentUser,
        initialState,
        brainRunId,
        ...(options && { options }),
        signal: this.abortController!.signal,
      })
      .catch((err: any) => {
        console.error(`[DO ${brainRunId}] BrainRunner run failed:`, err);
        throw err;
      })
      .finally(() => {
        this.abortController = null;
      });
  }

  /**
   * Wake up (resume) a brain from a previous execution point.
   * Webhook response data comes from signals, not as a parameter.
   * This method reconstructs state and calls BrainRunner.resume().
   */
  async wakeUp(brainRunId: string) {
    // Clear any pending timeout and cancel the alarm to prevent spurious alarm
    // fires after explicit resume. Safe because wakeUp() is only called when a
    // brain is suspended (waiting/paused), never during active iterate execution.
    const pendingTimeout = this.getWaitTimeout();
    if (pendingTimeout) {
      this.clearWaitTimeout(pendingTimeout.brainRunId);
      await this.ctx.storage.deleteAlarm();
    }

    // Use EventLoader to load events (handles R2 overflow transparently)
    const eventLoader = new EventLoader(this.sql, this.env.RESOURCES_BUCKET);

    // Get the brain title by loading the FIRST START event
    const startEvent = await eventLoader.loadEventByType(
      BRAIN_EVENTS.START,
      'ASC'
    );

    if (!startEvent) {
      throw new Error(`No START event found for brain run ${brainRunId}`);
    }

    const brainTitle = (startEvent as any).brainTitle;
    const initialState = (startEvent as any).initialState || {};
    const options = (startEvent as any).options || {};

    // Read run owner from durable storage (set once in start(), not from events)
    const ownerId = this.getRunOwner();
    if (!ownerId) {
      throw new Error(`No run owner found for brain run ${brainRunId}`);
    }
    const currentUser = { name: ownerId };

    // Use the brainRunId from the START event, not the parameter.
    // alarm() passes state.id.toString() (the DO hex ID), but the brain was
    // originally started with a UUID. Events must use the original UUID so
    // MonitorDO can correlate them with the existing brain_runs row.
    const originalBrainRunId = (startEvent as any).brainRunId || brainRunId;

    if (!brainTitle) {
      throw new Error(
        `Brain title not found in START event for brain run ${brainRunId}`
      );
    }

    // Load all events and feed them to the state machine to reconstruct execution tree
    const allEvents = await eventLoader.loadAllEvents();
    const machine = createBrainExecutionMachine({ initialState });
    for (const event of allEvents) {
      sendEvent(machine, event);
    }

    const { brainToRun, runner } = await this.prepareRunner(
      brainTitle,
      brainRunId,
      currentUser
    );

    runner
      .resume(brainToRun, {
        currentUser,
        machine,
        brainRunId: originalBrainRunId,
        options,
        signal: this.abortController!.signal,
      })
      .catch((err: any) => {
        console.error(
          `[DO ${originalBrainRunId}] BrainRunner wakeUp failed:`,
          err
        );
        throw err;
      })
      .finally(() => {
        this.abortController = null;
      });
  }

  async fetch(request: Request) {
    const { sql, eventStreamAdapter, brainRunId } = this;
    const url = new URL(request.url);
    const encoder = new TextEncoder();

    const sendEvent = (
      controller: ReadableStreamDefaultController,
      data: any
    ) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };

    let streamController: ReadableStreamDefaultController | null = null;
    try {
      if (url.pathname === '/watch') {
        // Create EventLoader for loading historical events (handles R2 overflow)
        const eventLoader = new EventLoader(sql, this.env.RESOURCES_BUCKET);

        const stream = new ReadableStream({
          start: async (controller) => {
            streamController = controller;
            try {
              // Load all historical events using EventLoader
              const existingEvents = await eventLoader.loadAllEvents();

              // Send all historical events as a single array message
              // so clients can process them in one batch instead of re-rendering per event
              if (existingEvents.length > 0) {
                sendEvent(controller, existingEvents);
              }

              eventStreamAdapter.subscribe(controller);
            } catch (err) {
              console.error(
                `[DO ${brainRunId} WATCH] Error during stream start:`,
                err
              );
              controller.close();
              if (streamController) {
                eventStreamAdapter.unsubscribe(streamController);
              }
              throw err;
            }
          },
          cancel: (reason) => {
            if (streamController)
              eventStreamAdapter.unsubscribe(streamController);
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

      console.warn(
        `[DO ${brainRunId}] fetch() called with unhandled path: ${url.pathname}`
      );
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error(`[DO ${brainRunId}] Error in fetch():`, error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}
