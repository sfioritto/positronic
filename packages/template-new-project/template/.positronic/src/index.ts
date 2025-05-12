import {
  api as app,
  setManifest,
  BrainRunnerDO,
  MonitorDO,
  PositronicManifest,
} from "@positronic/cloudflare";
// Import the generated manifest - NOTE the .js extension for runtime compatibility
// @ts-expect-error - _manifest.js is generated during template processing
import { staticManifest } from "./_manifest.js";

// Configure the manifest to use the statically generated list
const manifest = new PositronicManifest({
  staticManifest,
});

setManifest(manifest);

// Define Env type based on wrangler.jsonc bindings
interface Env {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
}

// Export the API handler and Durable Objects
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { BrainRunnerDO, MonitorDO };
