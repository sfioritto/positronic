import {
  api as app,
  setManifest,
  setBrainRunner,
  setWebhookManifest,
  BrainRunnerDO,
  MonitorDO,
  ScheduleDO,
  PositronicManifest,
} from "@positronic/cloudflare";
// Import the generated manifest - NOTE the .js extension for runtime compatibility
// @ts-expect-error - _manifest.js is generated during template processing
import { manifest as brainManifest } from "./_manifest.js";
import { runner } from "./runner.js";
// Configure the manifest to use the statically generated list
const manifest = new PositronicManifest({
  manifest: brainManifest,
});

setManifest(manifest);
setBrainRunner(runner);

// Register webhooks here if your brains use waitFor with webhooks
// Example:
// import { myWebhook } from '../../webhooks/my-webhook.js';
// setWebhookManifest({ 'my-webhook': myWebhook });
setWebhookManifest({});

// Define Env type based on wrangler.jsonc bindings
interface Env {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
  RESOURCES_BUCKET: R2Bucket;
}

// Export the API handler and Durable Objects
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { BrainRunnerDO, MonitorDO, ScheduleDO };
