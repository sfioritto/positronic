import type { D1Database } from "@cloudflare/workers-types";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";

export interface Env {
  /**
   * D1 Database binding.
   * This binding should be configured in the user's wrangler.toml.
   */
  DB: D1Database;

  /**
   * Durable Object namespace binding for WorkflowDO.
   * This binding should be configured in the user's wrangler.toml.
   */
  DO_NAMESPACE: DurableObjectNamespace;

  // Add other bindings or secrets as needed
  // Example: MY_SECRET: string;
}

// --- API Types --- //

export interface CreateRunRequest {
  workflowName: string;
  // Add other necessary parameters like input data, user context, etc.
}

export interface CreateRunResponse {
  workflowRunId: string;
  webSocketUrl: string;
}