import {
  api as app,
  setManifest,
  setBrainRunner,
  setWebhookManifest,
  BrainRunnerDO,
  MonitorDO,
  ScheduleDO,
  GovernorDO,
  AuthDO,
  PositronicManifest,
} from "@positronic/cloudflare";
import { collectPluginWebhooks } from "@positronic/core";
// Import the generated manifests - NOTE the .js extension for runtime compatibility
// @ts-expect-error - _manifest.js is generated during template processing
import { manifest as brainManifest } from "./_manifest.js";
// @ts-expect-error - _webhookManifest.js is generated during template processing
import { webhookManifest } from "./_webhookManifest.js";
import { runner } from "./runner.js";
import { brain as brainFactory } from "../brain.js";

// Configure the manifest to use the statically generated list
const manifest = new PositronicManifest({
  manifest: brainManifest,
});

// Merge file-based webhooks with plugin-declared webhooks
const pluginWebhooks = collectPluginWebhooks(brainFactory.plugins);

setManifest(manifest);
setBrainRunner(runner);
setWebhookManifest({ ...webhookManifest, ...pluginWebhooks });

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

export { BrainRunnerDO, MonitorDO, ScheduleDO, GovernorDO, AuthDO };
