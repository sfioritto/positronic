import { Hono } from 'hono';
import type { Bindings } from './types.js';

const governor = new Hono<{ Bindings: Bindings }>();

governor.get('/stats', async (c) => {
  const id = c.env.GOVERNOR_DO.idFromName('governor');
  const stub = c.env.GOVERNOR_DO.get(id);
  const stats = await stub.getStats();
  return c.json(stats);
});

export default governor;
