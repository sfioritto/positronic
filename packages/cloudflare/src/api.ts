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

  const workflowRunId = uuidv4();

  // --- TODO: Implement D1 Interaction --- //
  // Create initial record in `workflow_runs` table (status='INITIALIZING')
  // const db = c.env.DB;
  // await db.prepare(...).bind(...).run();

  // --- DO Interaction ---
  const doNamespace = c.env.DO_NAMESPACE;
  if (!doNamespace) {
    console.error('[api.ts] DO_NAMESPACE binding not found!');
    return c.json({ error: 'Internal Server Configuration Error: DO binding missing' }, 500);
  }
  // Use a deterministic ID for testing/simplicity for now, based on workflowRunId
  const doId = doNamespace.idFromString(workflowRunId);
  const stub = doNamespace.get(doId);

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

    if (!doResponse.ok) {
      const errorText = await doResponse.text();
      console.error(`[api.ts] DO stub.fetch(/init) failed: ${doResponse.status} ${errorText}`);
      return c.json({ error: `Failed to initialize workflow run: ${errorText}` }, 502); // 502 Bad Gateway
    }

  } catch (err: any) {
    console.error(`[api.ts] Error calling DO stub.fetch(/init): ${err.message || err}`);
    return c.json({ error: 'Internal Server Error communicating with workflow service' }, 500);
  }

  // --- Construct Actual WebSocket URL ---
  // This will depend on how the DO is exposed (e.g., via a service binding or specific route)
  const webSocketUrl = `wss://${c.req.header('host')}/ws/${workflowRunId}`; // Placeholder

  const response: CreateRunResponse = {
    workflowRunId,
    webSocketUrl,
  };

  return c.json(response, 201); // 201 Created
});

export default app;