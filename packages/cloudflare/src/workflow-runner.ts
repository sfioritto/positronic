import { DurableObject } from 'cloudflare:workers';

export interface Env {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace;
}

export class WorkflowRunnerDO extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }
}