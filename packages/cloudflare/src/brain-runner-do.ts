import { BrainRunner, type Resources } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';

import type { Adapter, BrainEvent } from '@positronic/core';
import { WorkflowRunSQLiteAdapter } from './sqlite-adapter.js';
import type { MonitorDO } from './monitor-do.js';
import { PositronicManifest } from './manifest.js';
import { CloudflareR2Loader } from './r2-loader.js';
import { createResources, type ResourceManifest } from '@positronic/core';
import type { R2Bucket } from '@cloudflare/workers-types';

let manifest: PositronicManifest | null = null;
export function setManifest(generatedManifest: PositronicManifest) {
  manifest = generatedManifest;
}

let brainRunner: BrainRunner | null = null;
export function setBrainRunner(runner: BrainRunner) {
  brainRunner = runner;
}

export interface Env {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
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

export class BrainRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private brainRunId: string;
  private eventStreamAdapter = new EventStreamAdapter();

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

  async start(
    brainName: string,
    brainRunId: string,
    initialData?: Record<string, any>
  ) {
    const { sql } = this;

    if (!manifest) {
      throw new Error('Runtime manifest not initialized');
    }

    const workflowToRun = await manifest.import(brainName);
    if (!workflowToRun) {
      console.error(
        `[DO ${brainRunId}] Workflow ${brainName} not found in manifest.`
      );
      console.error(JSON.stringify(manifest, null, 2));
      throw new Error(`Workflow ${brainName} not found`);
    }

    const sqliteAdapter = new WorkflowRunSQLiteAdapter(sql);
    const { eventStreamAdapter } = this;
    const monitorAdapter = new MonitorAdapter(
      this.env.MONITOR_DO.get(this.env.MONITOR_DO.idFromName('singleton'))
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

    runnerWithResources
      .withAdapters([sqliteAdapter, eventStreamAdapter, monitorAdapter])
      .run(workflowToRun, {
        initialState: initialData || {},
        brainRunId,
      })
      .catch((err: any) => {
        console.error(`[DO ${brainRunId}] BrainRunner run failed:`, err);
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
                FROM workflow_events
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
