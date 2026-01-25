import { BrainRunner, type Resources, STATUS, BRAIN_EVENTS, type RuntimeEnv, type ResumeContext, createBrainExecutionMachine, sendEvent, type ExecutionNode, type AgentContext } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';

import type { Adapter, BrainEvent } from '@positronic/core';
import { BrainRunSQLiteAdapter } from './sqlite-adapter.js';
import { WebhookAdapter } from './webhook-adapter.js';
import { PageAdapter } from './page-adapter.js';
import { createPagesService } from './pages-service.js';
import type { MonitorDO } from './monitor-do.js';
import type { ScheduleDO } from './schedule-do.js';
import { PositronicManifest } from './manifest.js';
import { CloudflareR2Loader } from './r2-loader.js';
import { createResources, type ResourceManifest } from '@positronic/core';
import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Convert ExecutionNode to ResumeContext, adding webhook response and agent context
 * to the deepest level.
 */
function executionTreeToResumeContext(
  node: ExecutionNode,
  webhookResponse: Record<string, any>,
  agentContext: AgentContext | null
): ResumeContext {
  if (!node.innerNode) {
    // This is the deepest level - add webhook response and agent context
    return {
      stepIndex: node.stepIndex,
      state: node.state,
      webhookResponse,
      agentContext: agentContext ?? undefined,
    };
  }
  // Recurse to find the deepest level
  return {
    stepIndex: node.stepIndex,
    state: node.state,
    innerResumeContext: executionTreeToResumeContext(node.innerNode, webhookResponse, agentContext),
  };
}

let manifest: PositronicManifest | null = null;
export function setManifest(generatedManifest: PositronicManifest) {
  manifest = generatedManifest;
}

export function getManifest(): PositronicManifest | null {
  return manifest;
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
  RESOURCES_BUCKET: R2Bucket;
  WORKER_URL?: string; // Base URL for the worker (e.g., "https://myapp.workers.dev")
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
  private buildRuntimeEnv(): RuntimeEnv {
    // Extract secrets: filter this.env to only string values
    // This automatically excludes infrastructure bindings (R2Bucket, DurableObjectNamespace are objects)
    const secrets: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (typeof value === 'string') {
        secrets[key] = value;
      }
    }

    return {
      origin: this.env.WORKER_URL || 'http://localhost:3000',
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
  async kill(brainRunId?: string, brainTitle?: string): Promise<{ success: boolean; message: string }> {
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
      const { sql } = this;
      try {
        const startEventResult = sql
          .exec<{ serialized_event: string }>(
            `SELECT serialized_event FROM brain_events WHERE event_type = ? ORDER BY event_id DESC LIMIT 1`,
            BRAIN_EVENTS.START
          )
          .toArray();

        if (startEventResult.length > 0) {
          startEvent = JSON.parse(startEventResult[0].serialized_event);
          actualBrainRunId = startEvent.brainRunId;
          actualBrainTitle = startEvent.brainTitle;
        }
      } catch (err) {
        // Table doesn't exist - brain was killed before any events were written to DO's SQLite
        console.log(`[DO ${this.brainRunId}] kill() could not query brain_events (table may not exist)`);
      }
    }

    // If we still don't have a brainRunId, we can't proceed
    if (!actualBrainRunId) {
      return { success: false, message: 'Brain run not found or never started' };
    }

    // Check MonitorDO status
    const existingRun = await monitorStub.getLastEvent(actualBrainRunId);
    if (!existingRun) {
      return { success: false, message: 'Brain run not found in monitor' };
    }

    // If already completed/cancelled/errored, nothing to do
    if (existingRun.status !== STATUS.RUNNING) {
      return { success: false, message: 'Brain run is not active or already completed' };
    }

    // Emit CANCELLED event
    const cancelledEvent: BrainEvent<any> = {
      type: BRAIN_EVENTS.CANCELLED,
      status: STATUS.CANCELLED,
      brainTitle: actualBrainTitle || String(existingRun.brain_title) || 'unknown',
      brainDescription: startEvent?.brainDescription || '',
      brainRunId: actualBrainRunId,
      options: startEvent?.options || {},
    };

    // Dispatch to PageAdapter for cleanup (deletes non-persistent pages from R2)
    // This is needed because when a brain is paused (waiting for webhook), the BrainRunner
    // has already returned and adapters aren't receiving events through the normal pipeline.
    // For zombie brains (server restarted), pageAdapter may be null, so we create one on the fly.
    const pageAdapter = this.pageAdapter ?? new PageAdapter(monitorStub, this.env.RESOURCES_BUCKET);
    await pageAdapter.dispatch(cancelledEvent);

    await monitorStub.handleBrainEvent(cancelledEvent);

    return { success: true, message: 'Brain run cancelled' };
  }

  async start(
    brainTitle: string,
    brainRunId: string,
    initialData?: Record<string, any>
  ) {
    const { sql } = this;

    if (!manifest) {
      throw new Error('Runtime manifest not initialized');
    }

    // Resolve the brain using the title/identifier
    const resolution = manifest.resolve(brainTitle);
    if (resolution.matchType === 'none') {
      console.error(
        `[DO ${brainRunId}] Brain ${brainTitle} not found in manifest.`
      );
      console.error(JSON.stringify(manifest, null, 2));
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
      throw new Error(`Brain ${brainTitle} resolved but brain object is missing`);
    }

    const sqliteAdapter = new BrainRunSQLiteAdapter(sql);
    const { eventStreamAdapter } = this;
    const monitorDOStub = this.env.MONITOR_DO.get(
      this.env.MONITOR_DO.idFromName('singleton')
    );
    const monitorAdapter = new MonitorAdapter(monitorDOStub);
    const scheduleAdapter = new ScheduleAdapter(
      this.env.SCHEDULE_DO.get(this.env.SCHEDULE_DO.idFromName('singleton'))
    );
    const webhookAdapter = new WebhookAdapter(monitorDOStub);
    this.pageAdapter = new PageAdapter(monitorDOStub, this.env.RESOURCES_BUCKET);

    // Create runtime environment with origin and secrets
    const env = this.buildRuntimeEnv();

    // Create pages service for brain to use
    const pagesService = createPagesService(
      brainRunId,
      this.env.RESOURCES_BUCKET,
      monitorDOStub,
      env
    );

    if (!brainRunner) {
      throw new Error('BrainRunner not initialized');
    }

    // Load resources from R2
    const r2Resources = await this.loadResourcesFromR2();
    // Create an enhanced runner with resources if available
    let runnerWithResources = brainRunner;

    // Use R2 resources if available
    if (r2Resources) {
      runnerWithResources = brainRunner.withResources(r2Resources);
    }

    // Add pages service and runtime env
    runnerWithResources = runnerWithResources.withPages(pagesService).withEnv(env);

    // Extract options from initialData if present
    const options = initialData?.options;
    const initialState = initialData && !initialData.options ? initialData : {};

    // Create abort controller for this run
    this.abortController = new AbortController();

    runnerWithResources
      .withAdapters([
        sqliteAdapter,
        eventStreamAdapter,
        monitorAdapter,
        scheduleAdapter,
        webhookAdapter,
        this.pageAdapter,
      ])
      .run(brainToRun, {
        initialState,
        brainRunId,
        ...(options && { options }),
        signal: this.abortController.signal,
      })
      .catch((err: any) => {
        console.error(`[DO ${brainRunId}] BrainRunner run failed:`, err);
        throw err; // Re-throw to ensure proper error propagation
      })
      .finally(() => {
        // Clean up abort controller when run completes
        this.abortController = null;
      });
  }

  async resume(
    brainRunId: string,
    webhookResponse: Record<string, any>
  ) {
    const { sql } = this;

    if (!manifest) {
      throw new Error('Runtime manifest not initialized');
    }

    // Get the brain title by loading the FIRST START event
    const startEventResult = sql
      .exec<{ serialized_event: string }>(
        `SELECT serialized_event FROM brain_events WHERE event_type = ? ORDER BY event_id ASC LIMIT 1`,
        BRAIN_EVENTS.START
      )
      .toArray();

    if (startEventResult.length === 0) {
      throw new Error(`No START event found for brain run ${brainRunId}`);
    }

    const startEvent = JSON.parse(startEventResult[0].serialized_event);
    const brainTitle = startEvent.brainTitle;
    const initialState = startEvent.initialState || {};

    if (!brainTitle) {
      throw new Error(`Brain title not found in START event for brain run ${brainRunId}`);
    }

    // Resolve the brain using the title
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
      throw new Error(`Brain ${brainTitle} resolved but brain object is missing`);
    }

    // Load all events and feed them to the state machine to reconstruct execution tree
    const allEventsResult = sql
      .exec<{ serialized_event: string }>(
        `SELECT serialized_event FROM brain_events ORDER BY event_id ASC`
      )
      .toArray();

    // Create state machine and feed all historical events to reconstruct execution state
    const machine = createBrainExecutionMachine({ initialState: initialState });
    for (const row of allEventsResult) {
      const event = JSON.parse(row.serialized_event);
      sendEvent(machine, event);
    }

    // Get the execution tree and agent context from the machine
    const { executionTree, agentContext } = machine.context;

    // Convert ExecutionNode to ResumeContext, adding webhook response and agent context
    // to the deepest level
    const resumeContext = executionTreeToResumeContext(
      executionTree!,
      webhookResponse,
      agentContext
    );

    const sqliteAdapter = new BrainRunSQLiteAdapter(sql);
    const { eventStreamAdapter } = this;
    const monitorDOStub = this.env.MONITOR_DO.get(
      this.env.MONITOR_DO.idFromName('singleton')
    );
    const monitorAdapter = new MonitorAdapter(monitorDOStub);
    const scheduleAdapter = new ScheduleAdapter(
      this.env.SCHEDULE_DO.get(this.env.SCHEDULE_DO.idFromName('singleton'))
    );
    const webhookAdapter = new WebhookAdapter(monitorDOStub);
    this.pageAdapter = new PageAdapter(monitorDOStub, this.env.RESOURCES_BUCKET);

    // Create runtime environment with origin and secrets
    const env = this.buildRuntimeEnv();

    // Create pages service for brain to use
    const pagesService = createPagesService(
      brainRunId,
      this.env.RESOURCES_BUCKET,
      monitorDOStub,
      env
    );

    if (!brainRunner) {
      throw new Error('BrainRunner not initialized');
    }

    // Load resources from R2
    const r2Resources = await this.loadResourcesFromR2();
    let runnerWithResources = brainRunner;

    if (r2Resources) {
      runnerWithResources = brainRunner.withResources(r2Resources);
    }

    // Add pages service and runtime env
    runnerWithResources = runnerWithResources.withPages(pagesService).withEnv(env);

    // Create abort controller for this run
    this.abortController = new AbortController();

    runnerWithResources
      .withAdapters([
        sqliteAdapter,
        eventStreamAdapter,
        monitorAdapter,
        scheduleAdapter,
        webhookAdapter,
        this.pageAdapter,
      ])
      .run(brainToRun, {
        resumeContext,
        brainRunId,
        signal: this.abortController.signal,
      })
      .catch((err: any) => {
        console.error(`[DO ${brainRunId}] BrainRunner resume failed:`, err);
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
        const stream = new ReadableStream({
          async start(controller) {
            streamController = controller;
            try {
              streamController = controller;
              const existingEventsSql = `
                SELECT serialized_event
                FROM brain_events
                ORDER BY event_id ASC;
              `;
              const existingEventsResult = sql
                .exec<{ serialized_event: string }>(existingEventsSql)
                .toArray();

              for (const row of existingEventsResult) {
                try {
                  const event = JSON.parse(row.serialized_event);
                  sendEvent(controller, event);
                } catch (parseError) {
                  console.error(
                    `[DO ${brainRunId} WATCH] Failed to parse historical event JSON: ${row.serialized_event}`,
                    parseError
                  );
                }
              }

              eventStreamAdapter.subscribe(controller);
            } catch (err) {
              console.error(
                `[DO ${brainRunId} WATCH] Error during stream start:`,
                err
              );
              controller.close();
              eventStreamAdapter.unsubscribe(streamController);
              throw err;
            }
          },
          cancel(reason) {
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
