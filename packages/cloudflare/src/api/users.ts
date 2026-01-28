import { Hono } from 'hono';
import type { Bindings } from './types.js';
import type { AuthDO } from '../auth-do.js';

const app = new Hono<{ Bindings: Bindings }>();

// Validation constants
const MAX_USERNAME_LENGTH = 64;
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a username
 * @returns null if valid, error message if invalid
 */
function validateUsername(name: unknown): string | null {
  if (!name || typeof name !== 'string') {
    return 'Name is required';
  }

  if (name.length === 0) {
    return 'Name cannot be empty';
  }

  if (name.length > MAX_USERNAME_LENGTH) {
    return `Name cannot exceed ${MAX_USERNAME_LENGTH} characters`;
  }

  if (!USERNAME_PATTERN.test(name)) {
    return 'Name can only contain letters, numbers, hyphens, and underscores';
  }

  return null;
}

// POST /users - Create a new user
app.post('/', async (c) => {
  try {
    const body = await c.req.json<{ name: string }>();

    const validationError = validateUsername(body.name);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    // Check if user already exists
    const existing = await authDo.getUserByName(body.name);
    if (existing) {
      return c.json({ error: `User '${body.name}' already exists` }, 409);
    }

    const user = await authDo.createUser(body.name);
    return c.json(user, 201);
  } catch (error) {
    console.error('Error creating user:', error);
    return c.json({ error: 'Failed to create user' }, 500);
  }
});

// GET /users - List all users
app.get('/', async (c) => {
  try {
    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    const result = await authDo.listUsers();
    return c.json(result);
  } catch (error) {
    console.error('Error listing users:', error);
    return c.json({ error: 'Failed to list users' }, 500);
  }
});

// GET /users/:id - Get a specific user
app.get('/:id', async (c) => {
  try {
    const userId = c.req.param('id');

    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    const user = await authDo.getUser(userId);
    if (!user) {
      return c.json({ error: `User '${userId}' not found` }, 404);
    }

    return c.json(user);
  } catch (error) {
    console.error('Error getting user:', error);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

// DELETE /users/:id - Delete a user
app.delete('/:id', async (c) => {
  try {
    const userId = c.req.param('id');

    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    const deleted = await authDo.deleteUser(userId);
    if (!deleted) {
      return c.json({ error: `User '${userId}' not found` }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    console.error('Error deleting user:', error);
    return c.json({ error: 'Failed to delete user' }, 500);
  }
});

// POST /users/:id/keys - Add a key to a user
app.post('/:id/keys', async (c) => {
  try {
    const userId = c.req.param('id');
    const body = await c.req.json<{
      jwk: object;
      fingerprint: string;
      label?: string;
    }>();

    if (!body.jwk || typeof body.jwk !== 'object') {
      return c.json({ error: 'JWK is required' }, 400);
    }

    if (!body.fingerprint || typeof body.fingerprint !== 'string') {
      return c.json({ error: 'Fingerprint is required' }, 400);
    }

    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    // Check if user exists
    const user = await authDo.getUser(userId);
    if (!user) {
      return c.json({ error: `User '${userId}' not found` }, 404);
    }

    // Check if key already exists
    const existingKey = await authDo.getKeyByFingerprint(body.fingerprint);
    if (existingKey) {
      return c.json({ error: 'Key already exists' }, 409);
    }

    const key = await authDo.addKey(
      userId,
      body.fingerprint,
      JSON.stringify(body.jwk),
      body.label || ''
    );

    // Return key without the jwk for security
    return c.json(
      {
        fingerprint: key.fingerprint,
        userId: key.userId,
        label: key.label,
        addedAt: key.addedAt,
      },
      201
    );
  } catch (error) {
    console.error('Error adding key:', error);
    return c.json({ error: 'Failed to add key' }, 500);
  }
});

// GET /users/:id/keys - List keys for a user
app.get('/:id/keys', async (c) => {
  try {
    const userId = c.req.param('id');

    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    // Check if user exists
    const user = await authDo.getUser(userId);
    if (!user) {
      return c.json({ error: `User '${userId}' not found` }, 404);
    }

    const result = await authDo.listKeys(userId);

    // Return keys without the jwk for security
    return c.json({
      keys: result.keys.map((key) => ({
        fingerprint: key.fingerprint,
        userId: key.userId,
        label: key.label,
        addedAt: key.addedAt,
      })),
      count: result.count,
    });
  } catch (error) {
    console.error('Error listing keys:', error);
    return c.json({ error: 'Failed to list keys' }, 500);
  }
});

// DELETE /users/:id/keys/:fingerprint - Remove a key from a user
app.delete('/:id/keys/:fingerprint', async (c) => {
  try {
    const userId = c.req.param('id');
    const fingerprint = decodeURIComponent(c.req.param('fingerprint'));

    const authDoId = c.env.AUTH_DO.idFromName('auth');
    const authDo = c.env.AUTH_DO.get(authDoId) as DurableObjectStub<AuthDO>;

    const deleted = await authDo.removeKey(userId, fingerprint);
    if (!deleted) {
      return c.json({ error: `Key not found` }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    console.error('Error removing key:', error);
    return c.json({ error: 'Failed to remove key' }, 500);
  }
});

export default app;
