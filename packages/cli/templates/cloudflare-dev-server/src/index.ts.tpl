import { api as app, setManifest, WorkflowRunnerDO, MonitorDO } from '@positronic/cloudflare';
import { PositronicManifest } from '@positronic/cloudflare/dist/src/manifest.js';
// Import the generated manifest - NOTE the .js extension for runtime compatibility
import { staticManifest } from './_manifest.js';

// Configure the manifest to use the statically generated list
const manifest = new PositronicManifest({
  staticManifest
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