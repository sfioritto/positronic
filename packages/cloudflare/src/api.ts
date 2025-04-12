import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { WorkflowRunnerDO } from './workflow-runner-do.js';

type Bindings = {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace<WorkflowRunnerDO>
}

type CreateRunRequest = {
  workflowName: string;
}

type CreateRunResponse = {
  workflowRunId: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post('/workflows/runs', async (context: Context) => {
    const { workflowName } = await context.req.json<CreateRunRequest>();

    if (!workflowName) {
        return context.json({ error: 'Missing workflowName in request body' }, 400);
    }

    const workflowRunId = uuidv4();
    const namespace = context.env.WORKFLOW_RUNNER_DO;
    const doId = namespace.idFromName(workflowRunId);
    const stub = namespace.get(doId);
    await stub.start(workflowName);
    const response: CreateRunResponse = {
        workflowRunId,
    };
    return context.json(response, 201);
});

app.get('/workflows/runs/:runId/status', async (context: Context) => {
    const runId = context.req.param('runId');
    const namespace = context.env.WORKFLOW_RUNNER_DO;
    const doId = namespace.idFromName(runId);
    const stub = namespace.get(doId);
    const response = await stub.fetch(new Request(`http://do/${doId}/status`));
    const statusData = await response.json();
    return context.json(statusData, response.status);
});

export default app;