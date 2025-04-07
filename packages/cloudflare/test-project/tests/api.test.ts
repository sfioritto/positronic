import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
// Import the worker (which now points to the Hono app)
import worker from "../src/index";

// Define the expected Env shape based on wrangler.jsonc for type safety in tests
interface TestEnv {
  DO_NAMESPACE: DurableObjectNamespace;
  DB: D1Database;
}

describe("Hono API Tests", () => {
  it("POST /runs without workflowName should return 400", async () => {
    // Cast the test env to the expected shape for type checking
    const testEnv = env as unknown as TestEnv;

    const request = new Request("http://example.com/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // Empty body, no workflowName
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
    // Optionally, check the error message in the response body
    const responseBody = await response.json();
    expect(responseBody).toEqual({ error: 'Missing workflowName in request body' });
  });

  // Add more tests here later...
});