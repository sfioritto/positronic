import { WorkflowRunner } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';
import type { Workflow, PromptClient, ResponseModel, Adapter, WorkflowEvent, SerializedStep } from '@positronic/core';
import { z, TypeOf } from 'zod';
import { WorkflowRunSQLiteAdapter } from './sqlite-adapter.js';
import { WORKFLOW_EVENTS } from '@positronic/core';

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

type StepWithoutPatch = Omit<SerializedStep, 'patch'>;

class WatchAdapter implements Adapter {
  private subscribers: Set<ReadableStreamDefaultController> = new Set();
  private encoder = new TextEncoder();

  subscribe(controller: ReadableStreamDefaultController) {
    this.subscribers.add(controller);
  }

  unsubscribe(controller: ReadableStreamDefaultController) {
    this.subscribers.delete(controller);
  }

  private broadcast(data: {
    type: typeof WORKFLOW_EVENTS['STEP_STATUS'],
    steps: StepWithoutPatch[],
  }) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encodedMessage = this.encoder.encode(message);
    this.subscribers.forEach(controller => {
      try {
        controller.enqueue(encodedMessage);
      } catch (e) {
        // Could happen if the client disconnected abruptly
        console.error("Failed to send message to subscriber, removing.", e);
        this.unsubscribe(controller);
      }
    });
  }

  async dispatch(event: WorkflowEvent<any>): Promise<void> {
    if (event.type === WORKFLOW_EVENTS.STEP_STATUS) {
      // Remove patch data before broadcasting steps
      const stepsWithoutPatch: StepWithoutPatch[] = event.steps.map(step => ({
        id: step.id,
        title: step.title,
        status: step.status,
      }));
      const broadcastData = {
        type: event.type,
        steps: stepsWithoutPatch,
      };
      this.broadcast(broadcastData);
    }
  }
}

export class WorkflowRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private workflowRunId: string;
  private watchAdapter = new WatchAdapter();

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

    const runner = new WorkflowRunner({
      adapters: [sqliteAdapter],
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
    const { sql } = this;
    const url = new URL(request.url);

    try {
      if (url.pathname === '/watch') {
        let timerId: number | undefined;
        const stream = new ReadableStream({
          start(controller) {
            timerId = setInterval(async () => {
              const statusSql = `SELECT status, error, started_at, completed_at FROM workflow_run`;
              const result = await sql.exec<{
                status: string;
                error: string | null;
                started_at: number;
                completed_at: number | null;
              }>(statusSql).one();
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(`${JSON.stringify(result)}\n\n`));
            }, 1000);
          },
          cancel() {
            if (timerId !== undefined) {
              clearInterval(timerId);
            }
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