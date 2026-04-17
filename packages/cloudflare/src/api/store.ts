import { Hono, type Context } from 'hono';
import { requireRoot } from './auth-middleware.js';
import { param } from './param.js';
import type { Bindings } from './types.js';

const store = new Hono<{ Bindings: Bindings }>();

/**
 * Get the userName for ownership filtering from the auth context.
 * Root users get null (no filter — sees everything).
 * Non-root users get their userName.
 */
function scopeUserName(context: Context): string | null {
  const auth = context.get('auth');
  return auth?.isRoot ? null : auth?.userName ?? null;
}

/**
 * Check if the authenticated user is root.
 */
function isRoot(context: Context): boolean {
  const auth = context.get('auth');
  return auth?.isRoot === true;
}

/**
 * Parse an R2 key from the store/ prefix into structured data.
 *
 * R2 key patterns:
 *   shared:   store/{brainTitle}/{key}.json
 *   per-user: store/{brainTitle}/user/{userName}/{key}.json
 */
function parseStoreKey(r2Key: string): {
  brainTitle: string;
  key: string;
  scope: 'shared' | 'user';
  userName?: string;
} | null {
  // Remove "store/" prefix
  const withoutPrefix = r2Key.slice('store/'.length);

  // Check for per-user pattern: {brainTitle}/user/{userName}/{key}.json
  const userMatch = withoutPrefix.match(/^([^/]+)\/user\/([^/]+)\/(.+)\.json$/);
  if (userMatch) {
    return {
      brainTitle: userMatch[1],
      key: userMatch[3],
      scope: 'user',
      userName: userMatch[2],
    };
  }

  // Check for shared pattern: {brainTitle}/{key}.json
  const sharedMatch = withoutPrefix.match(/^([^/]+)\/(.+)\.json$/);
  if (sharedMatch) {
    // Make sure it's not matching user/ prefix items
    if (sharedMatch[2].startsWith('user/')) {
      return null;
    }
    return {
      brainTitle: sharedMatch[1],
      key: sharedMatch[2],
      scope: 'shared',
    };
  }

  return null;
}

// GET /store/:brainTitle/shared/:key - Get shared key value (root only)
store.get('/:brainTitle/shared/:key', async (context: Context) => {
  if (!isRoot(context)) {
    return context.json({ error: 'Root access required' }, 403);
  }

  const bucket = context.env.RESOURCES_BUCKET;
  const brainTitle = decodeURIComponent(param(context, 'brainTitle'));
  const key = decodeURIComponent(param(context, 'key'));

  const r2Key = `store/${brainTitle}/${key}.json`;
  const object = await bucket.get(r2Key);

  if (!object) {
    return context.json({ error: `Key '${key}' not found` }, 404);
  }

  const value = JSON.parse(await object.text());

  return context.json({
    key,
    value,
    scope: 'shared',
  });
});

// GET /store/:brainTitle/user/:key - Get per-user key value
store.get('/:brainTitle/user/:key', async (context: Context) => {
  const userName = scopeUserName(context);

  if (!userName && !isRoot(context)) {
    return context.json({ error: 'Authentication required' }, 401);
  }

  const bucket = context.env.RESOURCES_BUCKET;
  const brainTitle = decodeURIComponent(param(context, 'brainTitle'));
  const key = decodeURIComponent(param(context, 'key'));

  // For root users, they could be looking at any user's key
  // But for non-root, it's always their own
  const targetUserName = userName!;
  const r2Key = `store/${brainTitle}/user/${targetUserName}/${key}.json`;
  const object = await bucket.get(r2Key);

  if (!object) {
    return context.json({ error: `Key '${key}' not found` }, 404);
  }

  const value = JSON.parse(await object.text());

  return context.json({
    key,
    value,
    scope: 'user',
    userName: targetUserName,
  });
});

// DELETE /store/:brainTitle/shared/:key - Delete shared key (root only)
store.delete('/:brainTitle/shared/:key', async (context: Context) => {
  if (!isRoot(context)) {
    return context.json({ error: 'Root access required' }, 403);
  }

  const bucket = context.env.RESOURCES_BUCKET;
  const brainTitle = decodeURIComponent(param(context, 'brainTitle'));
  const key = decodeURIComponent(param(context, 'key'));

  const r2Key = `store/${brainTitle}/${key}.json`;
  await bucket.delete(r2Key);

  return new Response(null, { status: 204 });
});

// DELETE /store/:brainTitle/user/:key - Delete per-user key
store.delete('/:brainTitle/user/:key', async (context: Context) => {
  const userName = scopeUserName(context);

  if (!userName && !isRoot(context)) {
    return context.json({ error: 'Authentication required' }, 401);
  }

  const bucket = context.env.RESOURCES_BUCKET;
  const brainTitle = decodeURIComponent(param(context, 'brainTitle'));
  const key = decodeURIComponent(param(context, 'key'));

  const targetUserName = userName!;
  const r2Key = `store/${brainTitle}/user/${targetUserName}/${key}.json`;
  await bucket.delete(r2Key);

  return new Response(null, { status: 204 });
});

// GET /store/:brainTitle - List keys for a brain
store.get('/:brainTitle', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;
  const brainTitle = decodeURIComponent(param(context, 'brainTitle'));
  const userName = scopeUserName(context);
  const rootUser = isRoot(context);

  const prefix = `store/${brainTitle}/`;
  const keys: Array<{
    key: string;
    scope: 'shared' | 'user';
    userName?: string;
    size: number;
    lastModified: string;
  }> = [];

  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });

    for (const object of listed.objects) {
      const parsed = parseStoreKey(object.key);
      if (!parsed) continue;

      // Access control: non-root only sees their own per-user keys
      if (!rootUser) {
        if (parsed.scope === 'shared') continue;
        if (parsed.scope === 'user' && parsed.userName !== userName) continue;
      }

      keys.push({
        key: parsed.key,
        scope: parsed.scope,
        ...(parsed.userName && { userName: parsed.userName }),
        size: object.size,
        lastModified: object.uploaded.toISOString(),
      });
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return context.json({
    keys,
    count: keys.length,
  });
});

// DELETE /store/:brainTitle - Clear all accessible keys for a brain
store.delete('/:brainTitle', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;
  const brainTitle = decodeURIComponent(param(context, 'brainTitle'));
  const userName = scopeUserName(context);
  const rootUser = isRoot(context);

  const prefix = `store/${brainTitle}/`;
  let deleted = 0;

  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });

    for (const object of listed.objects) {
      const parsed = parseStoreKey(object.key);
      if (!parsed) continue;

      // Access control: non-root only deletes their own per-user keys
      if (!rootUser) {
        if (parsed.scope === 'shared') continue;
        if (parsed.scope === 'user' && parsed.userName !== userName) continue;
      }

      await bucket.delete(object.key);
      deleted++;
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return context.json({ deleted });
});

// GET /store - List brains with store data
store.get('/', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;
  const userName = scopeUserName(context);
  const rootUser = isRoot(context);

  const brainTitles = new Set<string>();

  if (rootUser) {
    // Root: use delimiter to efficiently get brain title prefixes
    const listed = await bucket.list({ prefix: 'store/', delimiter: '/' });

    for (const prefix of listed.delimitedPrefixes) {
      // prefix is like "store/brain-name/"
      const title = prefix.slice('store/'.length, -1);
      if (title) {
        brainTitles.add(title);
      }
    }
  } else {
    // Non-root: list all store objects, filter to user's per-user keys
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix: 'store/', cursor });

      for (const object of listed.objects) {
        const parsed = parseStoreKey(object.key);
        if (!parsed) continue;

        if (parsed.scope === 'user' && parsed.userName === userName) {
          brainTitles.add(parsed.brainTitle);
        }
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  const brains = Array.from(brainTitles).sort();

  return context.json({
    brains,
    count: brains.length,
  });
});

export default store;
