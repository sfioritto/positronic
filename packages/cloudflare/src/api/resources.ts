import { Hono, type Context } from 'hono';
import { AwsClient } from 'aws4fetch';
import { type ResourceEntry, RESOURCE_TYPES } from '@positronic/core';
import type { Bindings } from './types.js';

// Override ResourceEntry to make path optional for resources that aren't in version control
type R2Resource = Omit<ResourceEntry, 'path'> & {
  path?: string;
  size: number;
  lastModified: string;
  local: boolean;
};

const resources = new Hono<{ Bindings: Bindings }>();

resources.get('/', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  try {
    // List all objects in the bucket
    // R2 returns up to 1000 objects by default
    const listed = await bucket.list();

    const resourceList: R2Resource[] = [];

    for (const object of listed.objects) {
      // Get the object to access its custom metadata
      const r2Object = await bucket.head(object.key);

      // Skip objects without type metadata (e.g., pages or other non-resource data)
      if (!r2Object || !r2Object.customMetadata?.type) {
        continue;
      }

      resourceList.push({
        type: r2Object.customMetadata.type as (typeof RESOURCE_TYPES)[number],
        ...(r2Object.customMetadata.path && {
          path: r2Object.customMetadata.path,
        }),
        key: object.key,
        size: object.size,
        lastModified: object.uploaded.toISOString(),
        local: r2Object.customMetadata.local === 'true', // R2 metadata is always strings
      });
    }

    return context.json({
      resources: resourceList,
      truncated: listed.truncated,
      count: resourceList.length,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return context.json({ error: errorMessage }, 500);
  }
});

resources.post('/', async (context: Context) => {
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
resources.delete('/:key', async (context: Context) => {
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
resources.delete('/', async (context: Context) => {
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

  // Delete only resources (objects with type metadata), not pages or other data
  for (const object of listed.objects) {
    const r2Object = await bucket.head(object.key);
    if (r2Object?.customMetadata?.type) {
      await bucket.delete(object.key);
      deletedCount++;
    }
  }

  // Handle pagination if there are more than 1000 objects
  let cursor = listed.cursor;
  while (listed.truncated && cursor) {
    const nextBatch = await bucket.list({ cursor });
    for (const object of nextBatch.objects) {
      const r2Object = await bucket.head(object.key);
      if (r2Object?.customMetadata?.type) {
        await bucket.delete(object.key);
        deletedCount++;
      }
    }
    cursor = nextBatch.cursor;
  }

  return context.json({ deletedCount });
});

// Generate presigned URL for large file uploads
resources.post('/presigned-link', async (context: Context) => {
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

export default resources;
