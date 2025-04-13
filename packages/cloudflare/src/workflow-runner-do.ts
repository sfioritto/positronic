import { WorkflowRunner } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';
import type { Workflow, PromptClient, ResponseModel, Adapter, WorkflowEvent } from '@positronic/core';
import { z, TypeOf } from 'zod';
import { WorkflowRunSQLiteAdapter } from './sqlite-adapter.js';

export type PositronicManifest = Record<string, Workflow | undefined>;

const baseClient: PromptClient = {
  execute: async <T extends z.AnyZodObject>(prompt: string, responseModel: ResponseModel<T>): Promise<TypeOf<T>> => {
    return "stuff" as any;
  },
};

let runtimeManifest: PositronicManifest = {};

export function setManifest(manifest: PositronicManifest) {
  runtimeManifest = manifest;
}

export interface Env {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace;
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
    this.subscribers.forEach(controller => {
      try {
        controller.enqueue(encodedMessage);
      } catch (e) {
        console.error("[DO_SSE_ADAPTER] Failed to send message to subscriber, removing.", e);
        this.unsubscribe(controller);
      }
    });
  }

  async dispatch(event: WorkflowEvent<any>): Promise<void> {
    try {
      this.broadcast(event);
    } catch (e) {
      console.error("[DO_SSE_ADAPTER] Error dispatching event:", e);
      throw e;
    }
  }
}

export class WorkflowRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private workflowRunId: string;
  private eventStreamAdapter = new EventStreamAdapter();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.workflowRunId = state.id.toString();
  }

  async start(workflowName: string, initialData?: Record<string, any>) {
    const { sql, workflowRunId } = this;

    const workflowToRun = runtimeManifest[workflowName];
    if (!workflowToRun) {
      console.error(`[DO ${workflowRunId}] Workflow ${workflowName} not found in manifest.`);
      throw new Error(`Workflow ${workflowName} not found`);
    }

    const sqliteAdapter = new WorkflowRunSQLiteAdapter(sql);
    const { eventStreamAdapter } = this;

    const runner = new WorkflowRunner({
      adapters: [sqliteAdapter, eventStreamAdapter],
      logger: {
        log: (...args) => console.log(`[DO ${workflowRunId} RUNNER]`, ...args),
      },
      verbose: true,
      client: baseClient,
    });

    runner.run(workflowToRun, {
        initialState: initialData || {},
        workflowRunId,
    }).catch(err => {
      console.error(`[DO ${workflowRunId}] WorkflowRunner run failed:`, err);
    });
  }

  async fetch(request: Request) {
    const { sql, eventStreamAdapter, workflowRunId } = this;
    const url = new URL(request.url);
    const encoder = new TextEncoder();

    const sendEvent = (controller: ReadableStreamDefaultController, data: any) => {
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
              const existingEventsResult = sql.exec<{ serialized_event: string }>(existingEventsSql).toArray();

              for (const row of existingEventsResult) {
                try {
                  const event = JSON.parse(row.serialized_event);
                  sendEvent(controller, event);
                } catch (parseError) {
                  console.error(`[DO ${workflowRunId} WATCH] Failed to parse historical event JSON: ${row.serialized_event}`, parseError);
                }
              }

              eventStreamAdapter.subscribe(controller);
            } catch (err) {
              console.error(`[DO ${workflowRunId} WATCH] Error during stream start:`, err);
              controller.close();
              eventStreamAdapter.unsubscribe(streamController);
              throw err;
            }
          },
          cancel(reason) {
            if (streamController) eventStreamAdapter.unsubscribe(streamController);
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      console.warn(`[DO ${workflowRunId}] fetch() called with unhandled path: ${url.pathname}`);
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error(`[DO ${workflowRunId}] Error in fetch():`, error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}