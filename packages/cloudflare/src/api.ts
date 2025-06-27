import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { AwsClient } from 'aws4fetch';
import type { BrainRunnerDO } from './brain-runner-do.js';
import type { MonitorDO } from './monitor-do.js';
import type { R2Bucket, R2Object } from '@cloudflare/workers-types';
import { type ResourceEntry, RESOURCE_TYPES } from '@positronic/core';

type Bindings = {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  RESOURCES_BUCKET: R2Bucket;
  NODE_ENV?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
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
  local: boolean;
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
          local: r2Object.customMetadata.local === 'true', // R2 metadata is always strings
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

app.get('/status', async (context: Context) => {
  return context.json({ ready: true });
});

app.post('/resources', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  const formData = await context.req.formData();

  const file = formData.get('file') as File | null;
  const type = formData.get('type') as string | null;
  const path = formData.get('path') as string | null;
  const key = formData.get('key') as string | null;
  const local = formData.get('local') as string | null;

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
        local: local === 'true' ? 'true' : 'false', // R2 metadata must be strings
      },
    });

    const resource: R2Resource = {
      type: type as (typeof RESOURCE_TYPES)[number],
      ...(path && { path }),
      key: objectKey,
      size: uploadedObject.size,
      lastModified: uploadedObject.uploaded.toISOString(),
      local: local === 'true',
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

  try {
    // Delete the resource - R2 delete is idempotent, so it's safe to delete non-existent resources
    await bucket.delete(decodedKey);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Failed to delete resource "${decodedKey}":`, error);
    return context.json(
      {
        error: `Failed to delete resource: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
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

// Generate presigned URL for large file uploads
app.post('/resources/presigned-link', async (context: Context) => {
  try {
    const body = await context.req.json();
    const { key, type, size } = body;

    // Validate required fields
    if (!key) {
      return context.json({ error: 'Missing required field "key"' }, 400);
    }
    if (!type) {
      return context.json({ error: 'Missing required field "type"' }, 400);
    }
    if (size === undefined || size === null) {
      return context.json({ error: 'Missing required field "size"' }, 400);
    }

    // Validate type
    if (type !== 'text' && type !== 'binary') {
      return context.json(
        { error: 'type must be either "text" or "binary"' },
        400
      );
    }

    // Check if R2 credentials are configured
    const {
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_ACCOUNT_ID,
      R2_BUCKET_NAME,
    } = context.env;

    if (
      !R2_ACCESS_KEY_ID ||
      !R2_SECRET_ACCESS_KEY ||
      !R2_ACCOUNT_ID ||
      !R2_BUCKET_NAME
    ) {
      return context.json(
        {
          error:
            'R2 credentials not configured. Please set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, and R2_BUCKET_NAME environment variables.',
        },
        400
      );
    }

    // Create AWS client with R2 credentials
    const client = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    });

    // Construct the R2 URL
    const url = new URL(
      `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`
    );

    // Set expiration to 1 hour (3600 seconds)
    const expiresIn = 3600;
    url.searchParams.set('X-Amz-Expires', expiresIn.toString());

    // Create a request to sign
    const requestToSign = new Request(url, {
      method: 'PUT',
      headers: {
        'x-amz-meta-type': type,
        'x-amz-meta-local': 'false', // Manual uploads are not local
      },
    });

    // Sign the request
    const signedRequest = await client.sign(requestToSign, {
      aws: {
        signQuery: true,
        service: 's3',
      },
    });

    // Return the presigned URL
    return context.json({
      url: signedRequest.url,
      method: 'PUT',
      expiresIn,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return context.json(
      {
        error: `Failed to generate presigned URL: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

export default app;
