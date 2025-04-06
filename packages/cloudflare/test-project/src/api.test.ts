import { describe, it, expect } from 'vitest';
// SELF is often globally available when using the pool, remove explicit import
// import { SELF } from '@cloudflare/vitest-pool-workers';
// Import types from the built library output
import type { CreateRunResponse } from '../../dist/types/types.js';

// Remove mockBindings, bindings come from wrangler.toml

describe('Hono API (/runs)', () => {
	// No need for mf: Miniflare variable

	// No need for beforeEach/afterEach in this simple case

	it('should return 201 Created with workflowRunId and webSocketUrl on valid POST /runs', async () => {
		const testWorkflowName = 'test-workflow';
		const requestBody = JSON.stringify({ workflowName: testWorkflowName });

		// Use self.fetch (standard worker global scope)
		const res = await self.fetch('http://localhost/runs', { // Hostname doesn't usually matter here
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: requestBody,
		});

		// Expectations
		expect(res.status).toBe(201);

		const body = await res.json() as CreateRunResponse;

		expect(body).toHaveProperty('workflowRunId');
		expect(typeof body.workflowRunId).toBe('string');
		expect(body.workflowRunId).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/); // UUID format

		expect(body).toHaveProperty('webSocketUrl');
		expect(typeof body.webSocketUrl).toBe('string');
		// Basic check for the URL format, might need refinement
		// The hostname might be different in the test environment
		expect(body.webSocketUrl).toMatch(/^wss?:\/\/.+\/ws\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
	});

	// Add more tests later (e.g., for missing workflowName, DO errors, etc.)
});