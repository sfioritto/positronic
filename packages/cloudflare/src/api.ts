import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import type { Env, CreateRunRequest, CreateRunResponse } from './types.js';

// Define the Hono app with Cloudflare Worker environment types
const app = new Hono<{ Bindings: Env }>();

app.post('/runs', async (c: Context<{ Bindings: Env }>) => {
  const { workflowName } = await c.req.json<CreateRunRequest>();

  if (!workflowName) {
    return c.json({ error: 'Missing workflowName in request body' }, 400);
  }

  // --- TODO: Implement Workflow Validation --- //
  // Check if workflowName exists in bundled manifest or D1 registry
  console.log(`Received request to run workflow: ${workflowName}`);

  const workflowRunId = uuidv4();
  console.log(`Generated workflowRunId: ${workflowRunId}`);

  // --- TODO: Implement D1 Interaction --- //
  // Create initial record in `workflow_runs` table (status='INITIALIZING')
  // const db = c.env.DB;
  // await db.prepare(...).bind(...).run();
  console.log('TODO: Write initial run record to D1');

  // --- TODO: Implement DO Interaction --- //
  // Get DO stub and call its /init endpoint
  // const doNamespace = c.env.DO_NAMESPACE;
  // const doId = doNamespace.idFromString(workflowRunId); // Or use a more robust ID scheme
  // const stub = doNamespace.get(doId);
  // await stub.fetch(new Request(`https://${c.req.headers.get('host')}/init`, {
  //   method: 'POST',
  //   body: JSON.stringify({ workflowRunId, workflowName /*, other config */ }),
  //   headers: { 'Content-Type': 'application/json' },
  // }));
  console.log('TODO: Get DO stub and call /init');

  // --- TODO: Construct Actual WebSocket URL --- //
  // This will depend on how the DO is exposed (e.g., via a service binding or specific route)
  const webSocketUrl = `wss://${c.req.header('host')}/ws/${workflowRunId}`; // Placeholder
  console.log(`Constructed placeholder WebSocket URL: ${webSocketUrl}`);

  const response: CreateRunResponse = {
    workflowRunId,
    webSocketUrl,
  };

  return c.json(response, 201); // 201 Created
});

export default app;