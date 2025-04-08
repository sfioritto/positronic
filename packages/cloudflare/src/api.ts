import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import { WorkflowRunnerDO } from './workflow-runner-do.js';

type Bindings = {
  WORKFLOW_RUNNER_DO: WorkflowRunnerDO
}

type CreateRunRequest = {
  workflowName: string
}

type CreateRunResponse = {
  workflowRunId: string
  webSocketUrl: string
}

// Define the Hono app with Cloudflare Worker environment types
const app = new Hono<{ Bindings: Bindings }>();

app.post('/runs', async (context: Context) => {
  const { workflowName } = await context.req.json<CreateRunRequest>();

  if (!workflowName) {
    return context.json({ error: 'Missing workflowName in request body' }, 400);
  }

  // --- TODO: Implement Workflow Validation --- //
  // Check if workflowName exists in bundled manifest or D1 registry

  const workflowRunId = uuidv4();

  // --- DO Interaction ---
  const doNamespace = context.env.WORKFLOW_RUNNER_DO;
  if (!doNamespace) {
    console.error('[api.ts] WORKFLOW_RUNNER_DO binding not found!');
    return context.json({ error: 'Internal Server Configuration Error: DO binding missing' }, 500);
  }
  // Use a deterministic ID for testing/simplicity for now, based on workflowRunId
  const doId = doNamespace.idFromString(workflowRunId);
  const stub = doNamespace.get(doId);

  try {
    // IMPORTANT: Use a realistic URL for the DO fetch, even in tests.
    // Using a relative path or placeholder might not work correctly.
    // Constructing a URL based on the incoming request host is safer.
    const initUrl = new URL(context.req.url);
    initUrl.pathname = '/init'; // Target the /init path on the DO

    const doResponse = await stub.fetch(initUrl.toString(), {
      method: 'POST',
      body: JSON.stringify({
        workflowRunId,
        workflowName,
        // TODO: Pass actual workflow registry if needed
        workflowRegistry: { [workflowName]: {} } // Pass dummy registry for now
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!doResponse.ok) {
      const errorText = await doResponse.text();
      console.error(`[api.ts] DO stub.fetch(/init) failed: ${doResponse.status} ${errorText}`);
      return context.json({ error: `Failed to initialize workflow run: ${errorText}` }, 502); // 502 Bad Gateway
    }

  } catch (err: any) {
    console.error(`[api.ts] Error calling DO stub.fetch(/init): ${err.message || err}`);
    return context.json({ error: 'Internal Server Error communicating with workflow service' }, 500);
  }

  // --- Construct Actual WebSocket URL ---
  // This will depend on how the DO is exposed (e.g., via a service binding or specific route)
  const webSocketUrl = `wss://${context.req.header('host')}/ws/${workflowRunId}`; // Placeholder

  const response: CreateRunResponse = {
    workflowRunId,
    webSocketUrl,
  };

  return context.json(response, 201); // 201 Created
});

export default app;