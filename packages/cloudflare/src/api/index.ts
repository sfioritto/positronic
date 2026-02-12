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

// Auth setup endpoint (no auth required) - returns setup instructions
app.get('/auth/setup', async (context: Context) => {
  const rootKeyConfigured = !!context.env.ROOT_PUBLIC_KEY;

  return context.json({
    backend: 'cloudflare',
    rootKeyConfigured,
    instructions: `To configure root authentication:
1. Run: px auth format-jwk-key
2. In Cloudflare dashboard, go to Workers & Pages > Your project > Settings > Variables and Secrets
3. Add a new secret named ROOT_PUBLIC_KEY
4. Paste the JWK value from step 1`,
  });
});

// Apply auth middleware to all routes except public endpoints
app.use('*', async (c, next) => {
  // Skip auth for unauthenticated endpoints
  if (c.req.path === '/status' || c.req.path === '/auth/setup') {
    return next();
  }

  // Skip auth for viewing pages (GET /pages/:slug but not GET /pages/ or /pages/:slug/meta)
  if (
    c.req.method === 'GET' &&
    c.req.path.startsWith('/pages/') &&
    !c.req.path.endsWith('/meta')
  ) {
    return next();
  }

  // Skip auth for bundle (needed to render pages)
  if (c.req.method === 'GET' && c.req.path.startsWith('/bundle/')) {
    return next();
  }

  // Skip auth for form submissions from generated pages (browser can't send JWT)
  if (c.req.method === 'POST' && c.req.path === '/webhooks/system/ui-form') {
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
