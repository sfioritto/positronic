import { WorkflowRunner } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';
import type { Workflow, PromptClient, ResponseModel } from '@positronic/core';
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

export class WorkflowRunnerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private workflowRunId: string;

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