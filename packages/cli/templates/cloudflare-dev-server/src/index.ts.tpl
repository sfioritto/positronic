import { api as app, setManifest, WorkflowRunnerDO, MonitorDO } from '@positronic/cloudflare';
import { PositronicManifest } from '@positronic/cloudflare/dist/src/manifest.js';
import path from 'node:path';
// import { fileURLToPath } from 'node:url'; // Not needed

// Determine the path to the user's workflows directory
// The worker's CWD is the .positronic directory.
const userWorkflowsPath = path.resolve('../workflows');

console.log(`[Positronic Dev Server] Loading workflows from: ${userWorkflowsPath}`);

// Configure the manifest to dynamically load workflows
const manifest = new PositronicManifest({
  workflowsDir: userWorkflowsPath
});

setManifest(manifest);

// Define Env type based on wrangler.jsonc bindings
interface Env {
  WORKFLOW_RUNNER_DO: DurableObjectNamespace<WorkflowRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
}

// Export the API handler and Durable Objects
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunnerDO, MonitorDO };