import { Miniflare } from 'miniflare';
import type { CreateRunResponse } from '../../src/types.js'; // Assuming types are exported from types.ts

// Simple bindings can remain here if needed in the future
const mockBindings = {};

describe('Hono API (/runs)', () => {
	let mf: Miniflare;

	beforeEach(() => {
		mf = new Miniflare({
			// Point scriptPath to the Hono API entry point
			scriptPath: 'packages/cloudflare/dist/src/api.js',
			modules: true,
			bindings: mockBindings, // Basic JSON-serializable bindings

			// Configure D1 Databases
			d1Databases: {
				DB: 'test-d1-db' // Miniflare will create an in-memory DB with this ID
			},

			// Configure Durable Objects
			durableObjects: {
				// The binding name used in the worker code (e.g., env.DO_NAMESPACE)
				DO_NAMESPACE: {
					// The *exported* class name from the script
					className: 'WorkflowDO',
					// The path to the script that exports the DO class.
					// This might need adjustment based on your build output.
					// If your Hono API and DO are bundled together, scriptPath might suffice.
					// If they are separate, provide the path to the DO script.
					// For now, let's assume it's bundled or accessible via the main scriptPath.
					// scriptName: 'dist/index.js' // Example if separate
				}
			},

			// We will need to mock the DO's fetch method more realistically later
			// or let Miniflare instantiate the actual DO and test its behavior.
		});
	});

	it('should return 201 Created with workflowRunId and webSocketUrl on valid POST /runs', async () => {
		const testWorkflowName = 'test-workflow';
		const requestBody = JSON.stringify({ workflowName: testWorkflowName });

		// Use dispatchFetch to send a request to the Miniflare instance
		const res = await mf.dispatchFetch('http://localhost/runs', {
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
		expect(body.webSocketUrl).toMatch(/^wss?:\/\/.+\/ws\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

		// Clean up the Miniflare instance after the test
		await mf.dispose();
	});

	// Add more tests later (e.g., for missing workflowName, DO errors, etc.)
});