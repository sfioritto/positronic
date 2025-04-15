import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { WorkflowRunnerDO } from './workflow-runner-do.js';
import type { MonitorDO } from './monitor-do.js';

type Bindings = {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace<WorkflowRunnerDO>
  MONITOR_DO: DurableObjectNamespace<MonitorDO>
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
    const stub = namespace.get(doId) as WorkflowRunnerDO;
    await stub.start(workflowName, workflowRunId);
    const response: CreateRunResponse = {
        workflowRunId,
    };
    return context.json(response, 201);
});

app.get('/workflows/runs/:runId/watch', async (context: Context) => {
    const runId = context.req.param('runId');
    const namespace = context.env.WORKFLOW_RUNNER_DO;
    const doId = namespace.idFromName(runId);
    const stub = namespace.get(doId);
    const response = await stub.fetch(new Request(`http://do/watch`));
    return response;
});

app.get('/workflows/:workflowName/history', async (context: Context) => {
  const workflowName = context.req.param('workflowName');
  const limit = Number(context.req.query('limit') || '10');

  // Get the monitor singleton instance
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId) as MonitorDO;

  const runs = await monitorStub.history(workflowName, limit);
  return context.json({ runs });
});

app.get('/workflows/watch', async (context: Context) => {
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    const response = await monitorStub.fetch(new Request(`http://do/watch`));
    return response;
});

export default app;