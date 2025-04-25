import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { BrainRunnerDO } from './brain-runner-do.js';
import type { MonitorDO } from './monitor-do.js';

type Bindings = {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>
  MONITOR_DO: DurableObjectNamespace<MonitorDO>
}

type CreateBrainRunRequest = {
  brainName: string;
}

type CreateBrainRunResponse = {
  brainRunId: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post('/brains/runs', async (context: Context) => {
    const { brainName } = await context.req.json<CreateBrainRunRequest>();

    if (!brainName) {
        return context.json({ error: 'Missing brainName in request body' }, 400);
    }

    const brainRunId = uuidv4();
    const namespace = context.env.BRAIN_RUNNER_DO;
    const doId = namespace.idFromName(brainRunId);
    const stub = namespace.get(doId) as BrainRunnerDO;
    await stub.start(brainName, brainRunId);
    const response: CreateBrainRunResponse = {
        brainRunId,
    };
    return context.json(response, 201);
});

app.get('/brains/runs/:runId/watch', async (context: Context) => {
    const runId = context.req.param('runId');
    const namespace = context.env.BRAIN_RUNNER_DO;
    const doId = namespace.idFromName(runId);
    const stub = namespace.get(doId);
    const response = await stub.fetch(new Request(`http://do/watch`));
    return response;
});

app.get('/brains/:brainName/history', async (context: Context) => {
  const brainName = context.req.param('brainName');
  const limit = Number(context.req.query('limit') || '10');

  // Get the monitor singleton instance
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId) as MonitorDO;

  const runs = await monitorStub.history(brainName, limit);
  return context.json({ runs });
});

app.get('/brains/watch', async (context: Context) => {
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    const response = await monitorStub.fetch(new Request(`http://do/watch`));
    return response;
});

export default app;