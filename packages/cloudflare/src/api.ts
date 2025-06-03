import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { BrainRunnerDO } from './brain-runner-do.js';
import type { MonitorDO } from './monitor-do.js';
import type { R2Bucket, R2Object } from '@cloudflare/workers-types';
import { type ResourceEntry, RESOURCE_TYPES } from '@positronic/core';

type Bindings = {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  RESOURCES_BUCKET: R2Bucket;
  NODE_ENV?: string;
};

type CreateBrainRunRequest = {
  brainName: string;
};

type CreateBrainRunResponse = {
  brainRunId: string;
};

// Override ResourceEntry to make path optional for resources that aren't in version control
type R2Resource = Omit<ResourceEntry, 'path'> & {
  path?: string;
  size: number;
  lastModified: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.post('/brains/runs', async (context: Context) => {
  const { brainName } = await context.req.json<CreateBrainRunRequest>();

  if (!brainName) {
    return context.json({ error: 'Missing brainName in request body' }, 400);
  }

  const brainRunId = uuidv4();
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(brainRunId);
  const stub = namespace.get(doId) as BrainRunnerDO;
  await stub.start(brainName, brainRunId);
  const response: CreateBrainRunResponse = {
    brainRunId,
  };
  return context.json(response, 201);
});

app.get('/brains/runs/:runId/watch', async (context: Context) => {
  const runId = context.req.param('runId');
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(runId);
  const stub = namespace.get(doId);
  const response = await stub.fetch(new Request(`http://do/watch`));
  return response;
});

app.get('/brains/:brainName/history', async (context: Context) => {
  const brainName = context.req.param('brainName');
  const limit = Number(context.req.query('limit') || '10');

  // Get the monitor singleton instance
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId) as MonitorDO;

  const runs = await monitorStub.history(brainName, limit);
  return context.json({ runs });
});

app.get('/brains/watch', async (context: Context) => {
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const response = await monitorStub.fetch(new Request(`http://do/watch`));
  return response;
});

app.get('/resources', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  try {
    // List all objects in the bucket
    // R2 returns up to 1000 objects by default
    const listed = await bucket.list();

    const resources = await Promise.all(
      listed.objects.map(async (object: R2Object) => {
        // Get the object to access its custom metadata
        const r2Object = await bucket.head(object.key);

        if (!r2Object) {
          throw new Error(`Resource "${object.key}" not found`);
        }

        if (!r2Object.customMetadata?.type) {
          throw new Error(
            `Resource "${object.key}" is missing required metadata field "type"`
          );
        }

        const resource: R2Resource = {
          type: r2Object.customMetadata.type as (typeof RESOURCE_TYPES)[number],
          ...(r2Object.customMetadata.path && {
            path: r2Object.customMetadata.path,
          }),
          key: object.key,
          size: object.size,
          lastModified: object.uploaded.toISOString(),
        };

        return resource;
      })
    );

    return context.json({
      resources,
      truncated: listed.truncated,
      count: resources.length,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return context.json({ error: errorMessage }, 500);
  }
});

app.post('/resources', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  const formData = await context.req.formData();

  const file = formData.get('file') as File | null;
  const type = formData.get('type') as string | null;
  const path = formData.get('path') as string | null;
  const key = formData.get('key') as string | null;

  if (!file) {
    return context.json({ error: 'Missing required field "file"' }, 400);
  }

  if (!type) {
    return context.json({ error: 'Missing required field "type"' }, 400);
  }

  if (!RESOURCE_TYPES.includes(type as any)) {
    return context.json(
      { error: `Field "type" must be one of: ${RESOURCE_TYPES.join(', ')}` },
      400
    );
  }

  // Either key or path must be provided
  if (!key && !path) {
    return context.json(
      { error: 'Either "key" or "path" must be provided' },
      400
    );
  }

  // Use key if provided, otherwise use path
  const objectKey = key || path!;

  try {
    // Upload to R2 with custom metadata
    const arrayBuffer = await file.arrayBuffer();
    const uploadedObject = await bucket.put(objectKey, arrayBuffer, {
      customMetadata: {
        type,
        ...(path && { path }),
      },
    });

    const resource: R2Resource = {
      type: type as (typeof RESOURCE_TYPES)[number],
      ...(path && { path }),
      key: objectKey,
      size: uploadedObject.size,
      lastModified: uploadedObject.uploaded.toISOString(),
    };

    return context.json(resource, 201);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to upload resource';
    return context.json({ error: errorMessage }, 500);
  }
});

// Delete a single resource by key
app.delete('/resources/:key', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;
  const key = context.req.param('key');

  // URL decode the key since it might contain slashes
  const decodedKey = decodeURIComponent(key);

  // Check if the resource exists
  const existingResource = await bucket.head(decodedKey);
  if (!existingResource) {
    return context.json({ error: `Resource "${decodedKey}" not found` }, 404);
  }

  // Delete the resource
  await bucket.delete(decodedKey);

  return new Response(null, { status: 204 });
});

// Delete all resources (bulk delete) - only available in development mode
app.delete('/resources', async (context: Context) => {
  // Check if we're in development mode
  const isDevelopment = context.env.NODE_ENV === 'development';

  if (!isDevelopment) {
    return context.json(
      { error: 'Bulk delete is only available in development mode' },
      403
    );
  }

  const bucket = context.env.RESOURCES_BUCKET;

  // List all objects
  const listed = await bucket.list();
  let deletedCount = 0;

  // Delete each object
  for (const object of listed.objects) {
    await bucket.delete(object.key);
    deletedCount++;
  }

  // Handle pagination if there are more than 1000 objects
  let cursor = listed.cursor;
  while (listed.truncated && cursor) {
    const nextBatch = await bucket.list({ cursor });
    for (const object of nextBatch.objects) {
      await bucket.delete(object.key);
      deletedCount++;
    }
    cursor = nextBatch.cursor;
  }

  return context.json({ deletedCount });
});

export default app;
