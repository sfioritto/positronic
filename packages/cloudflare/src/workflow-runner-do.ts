import { DurableObject } from 'cloudflare:workers';

export type SimpleManifestFunction = (...args: any[]) => any;
export type PositronicManifest = Record<string, SimpleManifestFunction>;

let runtimeManifest: PositronicManifest | null = null;

export function setRuntimeManifest(manifest: PositronicManifest) {
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
    const functionToRun = runtimeManifest![workflowName];
    const result = functionToRun();
    await this.state.storage.put('started', true);
    await this.state.storage.put('startResult', result);
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