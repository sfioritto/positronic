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
        console.error("Failed to send message to subscriber, removing.", e);
        this.unsubscribe(controller);
      }
    });
  }

  async dispatch(event: WorkflowEvent<any>): Promise<void> {
    try {
      this.broadcast(event);
    } catch (e) {
      console.error("Error dispatching event:", e);
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
      throw new Error(`Workflow ${workflowName} not found`);
    }

    const sqliteAdapter = new WorkflowRunSQLiteAdapter(sql);
    const { eventStreamAdapter } = this;

    const runner = new WorkflowRunner({
      adapters: [sqliteAdapter, eventStreamAdapter],
      logger: {
        log: console.log,
      },
      verbose: true,
      client: baseClient,
    });

    runner.run(workflowToRun, {
        initialState: initialData || {},
        workflowRunId,
    });
  }

  async fetch(request: Request) {
    const { sql, eventStreamAdapter } = this;
    const url = new URL(request.url);
    const encoder = new TextEncoder();

    const sendEvent = (controller: ReadableStreamDefaultController, data: any) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };

    let streamController: ReadableStreamDefaultController;
    try {
      if (url.pathname === '/watch') {
        const stream = new ReadableStream({
          async start(controller) {
            try {
              // Keep a reference to the controller so we can unsubscribe from it later in cancel()
              streamController = controller;
              // 1. Query and send historical events from the database
              const existingEventsSql = `
                SELECT serialized_event
                FROM workflow_events
                ORDER BY event_id ASC;
              `;
              const existingEventsResult = await sql.exec<{
                serialized_event: string
              }>(existingEventsSql).toArray();

              for (const row of existingEventsResult) {
                const event = JSON.parse(row.serialized_event);
                sendEvent(controller, event);
              }

              // Subscribe and send any new events as they come in
              eventStreamAdapter.subscribe(controller);
            } catch (err) {
              console.error("Error processing /watch request:", err);
              controller.close();
              eventStreamAdapter.unsubscribe(streamController);
              throw err;
            }
          },
          cancel(reason) {
            console.log('Client disconnected from /watch', reason);
            eventStreamAdapter.unsubscribe(streamController);
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

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Error fetching status', error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}