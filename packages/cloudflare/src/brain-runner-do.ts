import { BrainRunner, type Resources, STATUS, BRAIN_EVENTS } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';

import type { Adapter, BrainEvent } from '@positronic/core';
import { BrainRunSQLiteAdapter } from './sqlite-adapter.js';
import { WebhookAdapter } from './webhook-adapter.js';
import type { MonitorDO } from './monitor-do.js';
import type { ScheduleDO } from './schedule-do.js';
import { PositronicManifest } from './manifest.js';
import { CloudflareR2Loader } from './r2-loader.js';
import { createResources, type ResourceManifest } from '@positronic/core';
import type { R2Bucket } from '@cloudflare/workers-types';

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

let webhookManifest: Record<string, any> | null = null;
export function setWebhookManifest(manifest: Record<string, any>) {
  webhookManifest = manifest;
}

export function getWebhookManifest(): Record<string, any> | null {
  return webhookManifest;
}

export interface Env {
  BRAIN_RUNNER_DO: DurableObjectNamespace;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
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

export class BrainRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private brainRunId: string;
  private eventStreamAdapter = new EventStreamAdapter();
  private abortController: AbortController | null = null;

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
        console.warn(
          `[DO ${this.brainRunId}] Skipping resource ${object.key} - ` +
            `missing metadata.type (found: ${JSON.stringify(
              r2Object?.customMetadata || {}
            )})`
        );
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

  async kill(): Promise<{ success: boolean; message: string }> {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
      return { success: true, message: 'Brain run kill signal sent' };
    } else {
      return { success: false, message: 'Brain run is not active or already completed' };
    }
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

    // Get the initial state and brain title by loading the START or RESTART event
    const startEventResult = sql
      .exec<{ serialized_event: string }>(
        `SELECT serialized_event FROM brain_events WHERE event_type IN (?, ?) ORDER BY event_id DESC LIMIT 1`,
        BRAIN_EVENTS.START,
        BRAIN_EVENTS.RESTART
      )
      .toArray();

    if (startEventResult.length === 0) {
      throw new Error(`No START or RESTART event found for brain run ${brainRunId}`);
    }

    const startEvent = JSON.parse(startEventResult[0].serialized_event);
    const brainTitle = startEvent.brainTitle;
    const initialState = startEvent.initialState || {};

    if (!brainTitle) {
      throw new Error(`Brain title not found in START/RESTART event for brain run ${brainRunId}`);
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

    // Load completed steps from SQLite
    const eventsResult = sql
      .exec<{ serialized_event: string }>(
        `SELECT serialized_event FROM brain_events WHERE event_type = ? ORDER BY event_id ASC`,
        BRAIN_EVENTS.STEP_COMPLETE
      )
      .toArray();

    const initialCompletedSteps = eventsResult.map((row) => {
      const event = JSON.parse(row.serialized_event);
      return {
        id: event.stepId,
        title: event.stepTitle,
        status: STATUS.COMPLETE,
        patch: event.patch,
      };
    });

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

    if (!brainRunner) {
      throw new Error('BrainRunner not initialized');
    }

    // Load resources from R2
    const r2Resources = await this.loadResourcesFromR2();
    let runnerWithResources = brainRunner;

    if (r2Resources) {
      runnerWithResources = brainRunner.withResources(r2Resources);
    }

    // Create abort controller for this run
    this.abortController = new AbortController();

    runnerWithResources
      .withAdapters([
        sqliteAdapter,
        eventStreamAdapter,
        monitorAdapter,
        scheduleAdapter,
        webhookAdapter,
      ])
      .run(brainToRun, {
        initialState,
        initialCompletedSteps,
        brainRunId,
        response: webhookResponse,
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
