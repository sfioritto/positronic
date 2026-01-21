import { Hono, type Context } from 'hono';
import type { Bindings } from './types.js';
import brains from './brains.js';
import resources from './resources.js';
import webhooks from './webhooks/index.js';
import pages from './pages.js';
import secrets from './secrets.js';

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint
app.get('/status', async (context: Context) => {
  return context.json({ ready: true });
});

// Mount route modules
app.route('/brains', brains);
app.route('/resources', resources);
app.route('/webhooks', webhooks);
app.route('/pages', pages);
app.route('/secrets', secrets);

export default app;

// Re-export types for external use
export type { Bindings, HonoApp, CreateBrainRunRequest, CreateBrainRunResponse } from './types.js';
