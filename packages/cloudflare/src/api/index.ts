import { Hono, type Context } from 'hono';
import type { Bindings } from './types.js';
import brains from './brains.js';
import resources from './resources.js';
import webhooks from './webhooks/index.js';
import pages from './pages.js';
import secrets from './secrets.js';
import bundle from './bundle.js';
import users from './users.js';
import { authMiddleware } from './auth-middleware.js';

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint (no auth required)
app.get('/status', async (context: Context) => {
  return context.json({ ready: true });
});

// Apply auth middleware to all routes except /status
app.use('*', async (c, next) => {
  // Skip auth for /status endpoint
  if (c.req.path === '/status') {
    return next();
  }
  return authMiddleware()(c, next);
});

// Mount route modules
app.route('/brains', brains);
app.route('/resources', resources);
app.route('/webhooks', webhooks);
app.route('/pages', pages);
app.route('/secrets', secrets);
app.route('/bundle', bundle);
app.route('/users', users);

export default app;

// Re-export types for external use
export type { Bindings, HonoApp, CreateBrainRunRequest, CreateBrainRunResponse } from './types.js';
