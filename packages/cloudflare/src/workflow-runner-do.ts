import { WorkflowRunner } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';
import type { Workflow, PromptClient, ResponseModel } from '@positronic/core';
import { z, TypeOf } from 'zod';
import { WorkflowRunSQLiteAdapter } from './sqlite-adapter.js';

export type PositronicManifest = Record<string, Workflow | undefined>;

const baseClient: PromptClient = {
  execute: async <T extends z.AnyZodObject>(prompt: string, responseModel: ResponseModel<T>): Promise<TypeOf<T>> => {
    // Fake implementation returning a string, using type assertion to satisfy the generic type
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
  private state: any;
  private adapter: WorkflowRunSQLiteAdapter;

  constructor(state: any, env: Env) {
    super(state, env);
    this.state = state;
    this.adapter = new WorkflowRunSQLiteAdapter(state.storage.sql);
  }

  async startWorkflow(workflowName: string, initialData?: Record<string, any>) {
    const workflowToRun = runtimeManifest[workflowName];
    if (!workflowToRun) {
      throw new Error(`Workflow ${workflowName} not found`);
    }

    const runner = new WorkflowRunner({
      adapters: [this.adapter],
      logger: {
        log: console.log,
      },
      verbose: true,
      client: baseClient,
    });

    try {
      const result = await runner.run(workflowToRun, { initialState: initialData || {} });
      console.log(`Workflow ${workflowName} (DO ID: ${this.state.id}) completed with result:`, result);
      return result;
    } catch (error: any) {
      console.error(`Workflow ${workflowName} (DO ID: ${this.state.id}) failed:`, error.message, error.stack);
      throw error;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/start' && request.method === 'POST') {
      try {
        const body = await request.json<{ workflowName: string; initialData?: Record<string, any> }>();
        if (!body || !body.workflowName) {
          return new Response('Bad Request: Missing workflowName in JSON body', { status: 400 });
        }
        this.startWorkflow(body.workflowName, body.initialData).catch(e => console.error(`Background workflow failed: ${e.message}`));
        return new Response(JSON.stringify({ message: 'Workflow started', durableObjectId: this.state.id.toString() }), {
          headers: { 'Content-Type': 'application/json' },
          status: 202
        });
      } catch (e: any) {
        console.error("Error starting workflow:", e);
        return new Response(`Internal Server Error: ${e.message}`, { status: 500 });
      }
    }

    if (url.pathname === '/status') {
      try {
        const sql = `SELECT status, error, started_at, completed_at FROM workflow_runs WHERE id = ?`;
        // Use .first() to fetch the first row or null if no rows are found
        const result = await this.state.storage.sql.prepare(sql).bind(this.state.id.toString()).first();

        if (result == null) {
          return new Response(JSON.stringify({ status: 'not_found' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 404
          });
        }
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e: any) {
        console.error("Error fetching status:", e);
        return new Response(`Internal Server Error fetching status: ${e.message}`, { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  }
}