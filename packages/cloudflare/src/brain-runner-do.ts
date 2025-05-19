import { WorkflowRunner } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';
import { createResources } from '@positronic/core';
import type {
  Adapter,
  WorkflowEvent,
  ResourceLoader,
  ResourceManifest,
} from '@positronic/core';
import { WorkflowRunSQLiteAdapter } from './sqlite-adapter.js';
import type { MonitorDO } from './monitor-do.js';
import { PositronicManifest } from './manifest.js';

let manifest: PositronicManifest | null = null;
export function setManifest(generatedManifest: PositronicManifest) {
  manifest = generatedManifest;
}

let workflowRunner: WorkflowRunner | null = null;
export function setWorkflowRunner(runner: WorkflowRunner) {
  workflowRunner = runner;
}

export interface Env {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
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

  private broadcast(event: WorkflowEvent<any>) {
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

  async dispatch(event: WorkflowEvent<any>): Promise<void> {
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

  async dispatch(event: WorkflowEvent<any>): Promise<void> {
    await this.monitorStub.handleWorkflowEvent(event);
  }
}

class NoopResourceLoader implements ResourceLoader {
  async load(resourceName: string, type?: 'text'): Promise<string>;
  async load(resourceName: string, type: 'binary'): Promise<Buffer>;
  async load(
    resourceName: string,
    type?: 'text' | 'binary'
  ): Promise<string | Buffer> {
    if (type === 'binary') {
      // @ts-ignore: Buffer may not be available in all environments
      return typeof Buffer !== 'undefined' ? Buffer.from([]) : new Uint8Array();
    }
    return '';
  }
}

class NoopManifest implements ResourceManifest {
  [key: string]: any;
  async import(_brainName: string): Promise<undefined> {
    return undefined;
  }
}

export class BrainRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private workflowRunId: string;
  private eventStreamAdapter = new EventStreamAdapter();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.workflowRunId = state.id.toString();
  }

  async start(
    brainName: string,
    workflowRunId: string,
    initialData?: Record<string, any>
  ) {
    const { sql } = this;

    if (!manifest) {
      throw new Error('Runtime manifest not initialized');
    }

    const workflowToRun = await manifest.import(brainName);
    if (!workflowToRun) {
      console.error(
        `[DO ${workflowRunId}] Workflow ${brainName} not found in manifest.`
      );
      console.error(JSON.stringify(manifest, null, 2));
      throw new Error(`Workflow ${brainName} not found`);
    }

    const sqliteAdapter = new WorkflowRunSQLiteAdapter(sql);
    const { eventStreamAdapter } = this;
    const monitorAdapter = new MonitorAdapter(
      this.env.MONITOR_DO.get(this.env.MONITOR_DO.idFromName('singleton'))
    );

    if (!workflowRunner) {
      throw new Error('WorkflowRunner not initialized');
    }

    const loader = new NoopResourceLoader();
    const resourceManifest = new NoopManifest();

    const resources = createResources(loader, resourceManifest);

    workflowRunner
      .withAdapters([sqliteAdapter, eventStreamAdapter, monitorAdapter])
      .run(workflowToRun, {
        initialState: initialData || {},
        workflowRunId,
      })
      .catch((err) => {
        console.error(`[DO ${workflowRunId}] WorkflowRunner run failed:`, err);
      });
  }

  async fetch(request: Request) {
    const { sql, eventStreamAdapter, workflowRunId } = this;
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
                    `[DO ${workflowRunId} WATCH] Failed to parse historical event JSON: ${row.serialized_event}`,
                    parseError
                  );
                }
              }

              eventStreamAdapter.subscribe(controller);
            } catch (err) {
              console.error(
                `[DO ${workflowRunId} WATCH] Error during stream start:`,
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
        `[DO ${workflowRunId}] fetch() called with unhandled path: ${url.pathname}`
      );
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error(`[DO ${workflowRunId}] Error in fetch():`, error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}
