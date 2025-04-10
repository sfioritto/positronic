import { WorkflowRunner } from '@positronic/core';
import { DurableObject } from 'cloudflare:workers';
import type { Workflow, PromptClient, ResponseModel } from '@positronic/core';
import { z, TypeOf } from 'zod';

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
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
  }

  async start(workflowName: string) {
    const workflowToRun = runtimeManifest[workflowName];
    if (!workflowToRun) {
      throw new Error(`Workflow ${workflowName} not found`);
    }
    const runner = new WorkflowRunner({
      adapters: [],
      logger: {
        log: console.log,
      },
      verbose: false,
      client: baseClient,
    });
    const result = await runner.run(workflowToRun) as { message: string };
    await this.state.storage.put('started', true);
    await this.state.storage.put('startResult', result.message);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/isStarted') {
       const startedState = await this.state.storage.get('started');
       const startResult = await this.state.storage.get('startResult');
       const responseBody = {
           started: startedState === true,
           result: startResult
       };
       return new Response(JSON.stringify(responseBody), {
         headers: { 'Content-Type': 'application/json' },
       });
    }

    return new Response('Not found', { status: 404 });
  }
}