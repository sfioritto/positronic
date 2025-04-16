import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          durableObjects: {
            DO_NAMESPACE: "WorkflowRunOrchestratorDO",
          },
        },
      },
    },
  },
});