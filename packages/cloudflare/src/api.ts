import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowRunnerDO } from './workflow-runner-do.js';

type Bindings = {
  WORKFLOW_RUNNER_DO: WorkflowRunnerDO
}

type CreateRunRequest = {
  workflowName: string
}

type CreateRunResponse = {
  workflowRunId: string
}

const app = new Hono<{ Bindings: Bindings }>();

app.post('/workflows/runs', async (context: Context) => {
  const { workflowName } = await context.req.json<CreateRunRequest>();

  if (!workflowName) {
    return context.json({ error: 'Missing workflowName in request body' }, 400);
  }

  const workflowRunId = uuidv4();

  const namespace = context.env.WORKFLOW_RUNNER_DO;
  if (!namespace) {
    console.error('[api.ts] WORKFLOW_RUNNER_DO binding not found!');
    return context.json({ error: 'Internal Server Configuration Error: DO binding missing' }, 500);
  }
  // Use a deterministic ID based on the workflowRunId name
  const doId = namespace.idFromName(workflowRunId);
  const stub = namespace.get(doId);

  try {
    await stub.start();

  } catch (err: any) {
    console.error(`[api.ts] Error starting the workflow runner: ${err.message || err}`);
    return context.json({ error: 'Internal Server Error starting the workflow runner' }, 500);
  }

  const response: CreateRunResponse = {
    workflowRunId,
  };

  return context.json(response, 201); // 201 Created
});

export default app;