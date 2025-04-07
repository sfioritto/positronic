import app from '../../src/api';

// Re-export the fetch handler from the imported Hono app
export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
