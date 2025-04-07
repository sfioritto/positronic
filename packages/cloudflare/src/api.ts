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

  // --- DO Interaction ---
  console.log('[api.ts] Attempting to get DO Namespace binding...');
  const doNamespace = c.env.DO_NAMESPACE;
  if (!doNamespace) {
    console.error('[api.ts] DO_NAMESPACE binding not found!');
    return c.json({ error: 'Internal Server Configuration Error: DO binding missing' }, 500);
  }
  console.log('[api.ts] DO Namespace binding found. Creating ID...');
  // Use a deterministic ID for testing/simplicity for now, based on workflowRunId
  const doId = doNamespace.idFromString(workflowRunId);
  console.log(`[api.ts] DO ID created: ${doId}. Getting DO stub...`);
  const stub = doNamespace.get(doId);
  console.log('[api.ts] DO stub retrieved. Calling stub.fetch(/init)...');

  try {
    // IMPORTANT: Use a realistic URL for the DO fetch, even in tests.
    // Using a relative path or placeholder might not work correctly.
    // Constructing a URL based on the incoming request host is safer.
    const initUrl = new URL(c.req.url);
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

    console.log(`[api.ts] DO stub.fetch(/init) response status: ${doResponse.status}`);

    if (!doResponse.ok) {
      const errorText = await doResponse.text();
      console.error(`[api.ts] DO stub.fetch(/init) failed: ${doResponse.status} ${errorText}`);
      return c.json({ error: `Failed to initialize workflow run: ${errorText}` }, 502); // 502 Bad Gateway
    }

  } catch (err: any) {
    console.error(`[api.ts] Error calling DO stub.fetch(/init): ${err.message || err}`);
    return c.json({ error: 'Internal Server Error communicating with workflow service' }, 500);
  }

  console.log('[api.ts] DO stub.fetch(/init) call successful.');

  // --- Construct Actual WebSocket URL ---
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