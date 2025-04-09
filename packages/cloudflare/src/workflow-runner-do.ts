import { DurableObject } from 'cloudflare:workers';

export interface Env {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace;
}

export class WorkflowRunnerDO extends DurableObject<Env> {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.state = state;
  }

  async start() {
    // Store a simple value to indicate the DO has started
    await this.state.storage.put('started', true);
  }

  // Handle requests to the DO
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/isStarted') {
      const started = (await this.state.storage.get('started')) === true;
      return new Response(JSON.stringify({ started }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  }
}