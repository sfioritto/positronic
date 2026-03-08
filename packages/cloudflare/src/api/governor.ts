import { Hono } from 'hono';
import type { Bindings } from './types.js';

const governor = new Hono<{ Bindings: Bindings }>();

governor.get('/stats', async (c) => {
  const identity = c.req.query('identity');
  if (!identity) {
    return c.json({ error: 'identity query parameter is required' }, 400);
  }

  const id = c.env.GOVERNOR_DO.idFromName(identity);
  const stub = c.env.GOVERNOR_DO.get(id);
  const stats = await stub.getStats();
  return c.json(stats);
});

export default governor;
