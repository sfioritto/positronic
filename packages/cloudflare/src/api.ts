import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { AwsClient } from 'aws4fetch';
import { parseCronExpression } from 'cron-schedule';
import type { BrainRunnerDO } from './brain-runner-do.js';
import { getManifest, getWebhookManifest } from './brain-runner-do.js';
import type { MonitorDO } from './monitor-do.js';
import type { ScheduleDO } from './schedule-do.js';
import type { R2Bucket, R2Object } from '@cloudflare/workers-types';
import { type ResourceEntry, RESOURCE_TYPES } from '@positronic/core';

type Bindings = {
  BRAIN_RUNNER_DO: DurableObjectNamespace<BrainRunnerDO>;
  MONITOR_DO: DurableObjectNamespace<MonitorDO>;
  SCHEDULE_DO: DurableObjectNamespace<ScheduleDO>;
  RESOURCES_BUCKET: R2Bucket;
  NODE_ENV?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  // Cloudflare API credentials for secrets management
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_SCRIPT_NAME?: string;
  // Origin URL for constructing page URLs
  WORKER_URL?: string;
};

type CreateBrainRunRequest = {
  brainTitle: string;
  options?: Record<string, string>;
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

/**
 * Get the origin URL for constructing page URLs.
 * Uses WORKER_URL env var if set, otherwise falls back to request URL.
 */
function getOrigin(context: Context): string {
  if (context.env.WORKER_URL) {
    return context.env.WORKER_URL;
  }
  const url = new URL(context.req.url);
  return `${url.protocol}//${url.host}`;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post('/brains/runs', async (context: Context) => {
  const requestBody = await context.req.json<CreateBrainRunRequest & { identifier?: string }>();
  const { options } = requestBody;
  
  // Support both identifier and brainTitle for backward compatibility
  const identifier = requestBody.identifier || requestBody.brainTitle;

  if (!identifier) {
    return context.json({ error: 'Missing identifier or brainTitle in request body' }, 400);
  }

  // Validate that the brain exists before starting it
  const manifest = getManifest();
  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }

  // Resolve the identifier to find the brain
  const resolution = manifest.resolve(identifier);
  
  if (resolution.matchType === 'none') {
    return context.json({ error: `Brain '${identifier}' not found` }, 404);
  }
  
  if (resolution.matchType === 'multiple') {
    return context.json({
      error: 'Multiple brains match the identifier',
      matchType: 'multiple',
      candidates: resolution.candidates
    }, 409);
  }
  
  const brain = resolution.brain!;

  const brainRunId = uuidv4();
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(brainRunId);
  const stub = namespace.get(doId);
  
  // Pass options to the brain runner if provided
  const initialData = options ? { options } : undefined;
  // Get the actual brain title from the resolved brain
  const brainTitle = (brain as any).title || identifier;
  await stub.start(brainTitle, brainRunId, initialData);
  
  const response: CreateBrainRunResponse = {
    brainRunId,
  };
  return context.json(response, 201);
});

app.post('/brains/runs/rerun', async (context: Context) => {
  const requestBody = await context.req.json<any>();
  const { runId, startsAt, stopsAfter } = requestBody;
  
  // Support both identifier and brainTitle for backward compatibility
  const identifier = requestBody.identifier || requestBody.brainTitle;

  if (!identifier) {
    return context.json({ error: 'Missing identifier or brainTitle in request body' }, 400);
  }

  // Validate that the brain exists
  const manifest = getManifest();
  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }

  // Resolve the identifier to find the brain
  const resolution = manifest.resolve(identifier);
  
  if (resolution.matchType === 'none') {
    return context.json({ error: `Brain '${identifier}' not found` }, 404);
  }
  
  if (resolution.matchType === 'multiple') {
    return context.json({
      error: 'Multiple brains match the identifier',
      matchType: 'multiple',
      candidates: resolution.candidates
    }, 409);
  }
  
  const brain = resolution.brain!;

  // If runId is provided, validate it exists
  if (runId) {
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    const existingRun = await monitorStub.getLastEvent(runId);
    
    if (!existingRun) {
      return context.json({ error: `Brain run '${runId}' not found` }, 404);
    }
  }

  // Create a new brain run with rerun parameters
  const newBrainRunId = uuidv4();
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(newBrainRunId);
  const stub = namespace.get(doId);
  
  // Start the brain with rerun options
  const rerunOptions = {
    ...(runId && { originalRunId: runId }),
    ...(startsAt !== undefined && { startsAt }),
    ...(stopsAfter !== undefined && { stopsAfter }),
  };
  
  // Get the actual brain title from the resolved brain
  const brainTitle = (brain as any).title || identifier;
  await stub.start(brainTitle, newBrainRunId, rerunOptions);
  
  const response: CreateBrainRunResponse = {
    brainRunId: newBrainRunId,
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

app.get('/brains/runs/:runId', async (context: Context) => {
  const runId = context.req.param('runId');

  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const run = await monitorStub.getRun(runId);

  if (!run) {
    return context.json({ error: `Brain run '${runId}' not found` }, 404);
  }

  return context.json(run);
});

app.delete('/brains/runs/:runId', async (context: Context) => {
  const runId = context.req.param('runId');
  
  // First check if the run exists in the monitor
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const existingRun = await monitorStub.getLastEvent(runId);
  
  if (!existingRun) {
    return context.json({ error: `Brain run '${runId}' not found` }, 404);
  }
  
  // Now try to kill it
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(runId);
  const stub = namespace.get(doId);
  
  try {
    // Call the kill method on the Durable Object
    const result = await stub.kill();
    
    if (!result.success) {
      // Brain run is not active or already completed
      return context.json({ error: result.message }, 409);
    }
    
    // Return 204 No Content on success
    return new Response(null, { status: 204 });
  } catch (error: any) {
    console.error(`Error killing brain run ${runId}:`, error);
    return context.json({ error: 'Failed to kill brain run' }, 500);
  }
});

app.get('/brains/:identifier/history', async (context: Context) => {
  const identifier = context.req.param('identifier');
  const limit = Number(context.req.query('limit') || '10');
  
  // Resolve the identifier to get the actual brain title
  const manifest = getManifest();
  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }
  
  const resolution = manifest.resolve(identifier);
  if (resolution.matchType === 'none') {
    return context.json({ error: `Brain '${identifier}' not found` }, 404);
  }
  
  if (resolution.matchType === 'multiple') {
    return context.json({
      error: 'Multiple brains match the identifier',
      matchType: 'multiple',
      candidates: resolution.candidates
    }, 300);
  }
  
  // Get the actual brain title
  const brain = resolution.brain!;
  const brainTitle = (brain as any).title || identifier;

  // Get the monitor singleton instance
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);

  const runs = await monitorStub.history(brainTitle, limit);
  return context.json({ runs });
});

app.get('/brains/:identifier/active-runs', async (context: Context) => {
  const identifier = context.req.param('identifier');
  
  // Resolve the identifier to get the actual brain title
  const manifest = getManifest();
  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }
  
  const resolution = manifest.resolve(identifier);
  if (resolution.matchType === 'none') {
    return context.json({ error: `Brain '${identifier}' not found` }, 404);
  }
  
  if (resolution.matchType === 'multiple') {
    return context.json({
      error: 'Multiple brains match the identifier',
      matchType: 'multiple',
      candidates: resolution.candidates
    }, 300);
  }
  
  // Get the actual brain title
  const brain = resolution.brain!;
  const brainTitle = (brain as any).title || identifier;

  // Get the monitor singleton instance
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);

  const runs = await monitorStub.activeRuns(brainTitle);
  return context.json({ runs });
});

app.get('/brains/watch', async (context: Context) => {
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const response = await monitorStub.fetch(new Request(`http://do/watch`));
  return response;
});

app.get('/brains', async (context: Context) => {
  const manifest = getManifest();
  
  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }

  const brainFilenames = manifest.list();
  const brains = await Promise.all(
    brainFilenames.map(async (filename) => {
      const brain = await manifest.import(filename);
      if (!brain) {
        return null;
      }
      
      const structure = brain.structure;
      return {
        filename,
        title: structure.title,
        description: structure.description || `${structure.title} brain`,
      };
    })
  );

  // Filter out any null entries
  const validBrains = brains.filter(brain => brain !== null);

  return context.json({
    brains: validBrains,
    count: validBrains.length,
  });
});

// Schedule endpoints

// Create a new schedule
app.post('/brains/schedules', async (context: Context) => {
  try {
    const body = await context.req.json();
    const { cronExpression } = body;
    
    // Support both identifier and brainTitle for backward compatibility
    const identifier = body.identifier || body.brainTitle;

    if (!identifier) {
      return context.json({ error: 'Missing required field "identifier" or "brainTitle"' }, 400);
    }
    if (!cronExpression) {
      return context.json(
        { error: 'Missing required field "cronExpression"' },
        400
      );
    }

    // Validate cron expression before calling DO
    try {
      parseCronExpression(cronExpression);
    } catch {
      return context.json(
        { error: `Invalid cron expression: ${cronExpression}` },
        400
      );
    }

    // Resolve the identifier to get the actual brain title
    const manifest = getManifest();
    if (!manifest) {
      return context.json({ error: 'Manifest not initialized' }, 500);
    }
    
    const resolution = manifest.resolve(identifier);
    if (resolution.matchType === 'none') {
      return context.json({ error: `Brain '${identifier}' not found` }, 404);
    }
    
    if (resolution.matchType === 'multiple') {
      return context.json({
        error: 'Multiple brains match the identifier',
        matchType: 'multiple',
        candidates: resolution.candidates
      }, 409);
    }
    
    // Get the actual brain title
    const brain = resolution.brain!;
    const brainTitle = (brain as any).title || identifier;

    // Get the schedule singleton instance
    const scheduleId = context.env.SCHEDULE_DO.idFromName('singleton');
    const scheduleStub = context.env.SCHEDULE_DO.get(scheduleId);

    const schedule = await scheduleStub.createSchedule(
      brainTitle,
      cronExpression
    );
    return context.json(schedule, 201);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create schedule';
    return context.json({ error: errorMessage }, 400);
  }
});

// List all schedules
app.get('/brains/schedules', async (context: Context) => {
  const scheduleId = context.env.SCHEDULE_DO.idFromName('singleton');
  const scheduleStub = context.env.SCHEDULE_DO.get(scheduleId);

  const result = await scheduleStub.listSchedules();
  return context.json(result);
});

// Get scheduled run history - MUST be before :scheduleId route
app.get('/brains/schedules/runs', async (context: Context) => {
  const scheduleIdParam = context.req.query('scheduleId');
  const limit = Number(context.req.query('limit') || '100');

  const scheduleDoId = context.env.SCHEDULE_DO.idFromName('singleton');
  const scheduleStub = context.env.SCHEDULE_DO.get(scheduleDoId);

  const result = await scheduleStub.getAllRuns(scheduleIdParam, limit);
  return context.json(result);
});

// Delete a schedule
app.delete('/brains/schedules/:scheduleId', async (context: Context) => {
  const scheduleIdParam = context.req.param('scheduleId');

  const scheduleDoId = context.env.SCHEDULE_DO.idFromName('singleton');
  const scheduleStub = context.env.SCHEDULE_DO.get(scheduleDoId);

  const deleted = await scheduleStub.deleteSchedule(scheduleIdParam);

  if (!deleted) {
    return context.json({ error: 'Schedule not found' }, 404);
  }

  return new Response(null, { status: 204 });
});

app.get('/brains/:identifier', async (context: Context) => {
  const identifier = context.req.param('identifier');
  const manifest = getManifest();
  
  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }

  // Resolve the identifier to find the brain
  const resolution = manifest.resolve(identifier);
  
  if (resolution.matchType === 'none') {
    return context.json({ error: `Brain '${identifier}' not found` }, 404);
  }
  
  if (resolution.matchType === 'multiple') {
    return context.json({
      error: 'Multiple brains match the identifier',
      matchType: 'multiple',
      candidates: resolution.candidates
    }, 300);
  }
  
  const brain = resolution.brain!;

  // Get the brain structure
  const structure = brain.structure;

  return context.json({
    title: structure.title,
    description: structure.description || `${structure.title} brain`,
    steps: structure.steps,
  });
});

app.get('/resources', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  try {
    // List all objects in the bucket
    // R2 returns up to 1000 objects by default
    const listed = await bucket.list();

    const resources: R2Resource[] = [];

    for (const object of listed.objects) {
      // Get the object to access its custom metadata
      const r2Object = await bucket.head(object.key);

      // Skip objects without type metadata (e.g., pages or other non-resource data)
      if (!r2Object || !r2Object.customMetadata?.type) {
        continue;
      }

      resources.push({
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

// Webhook endpoints

// List all webhooks
app.get('/webhooks', async (context: Context) => {
  const webhookManifest = getWebhookManifest();

  if (!webhookManifest) {
    return context.json({ webhooks: [], count: 0 });
  }

  const webhooks = Object.entries(webhookManifest).map(([slug, webhook]: [string, any]) => ({
    slug,
    description: webhook.description,
  }));

  return context.json({
    webhooks,
    count: webhooks.length,
  });
});

// Receive incoming webhook from external service
app.post('/webhooks/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const webhookManifest = getWebhookManifest();

  if (!webhookManifest) {
    return context.json({ error: 'Webhook manifest not initialized' }, 500);
  }

  const webhook = webhookManifest[slug];

  if (!webhook) {
    return context.json({ error: `Webhook '${slug}' not found` }, 404);
  }

  try {
    // Call the webhook handler to process the incoming request
    const result = await webhook.handler(context.req.raw);

    // Handle verification challenge (for Slack, Stripe, GitHub, Discord)
    if (result.type === 'verification') {
      return context.json({ challenge: result.challenge });
    }

    // Normal webhook processing - check if there's a brain waiting
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    const brainRunId = await monitorStub.findWaitingBrain(slug, result.identifier);

    if (brainRunId) {
      // Found a brain waiting for this webhook - resume it
      const namespace = context.env.BRAIN_RUNNER_DO;
      const doId = namespace.idFromName(brainRunId);
      const stub = namespace.get(doId);

      // Resume the brain with the webhook response
      await stub.resume(brainRunId, result.response);

      return context.json({
        received: true,
        action: 'resumed',
        identifier: result.identifier,
        brainRunId,
      });
    }

    // No brain waiting for this webhook
    return context.json({
      received: true,
      action: 'queued',
      identifier: result.identifier,
    });
  } catch (error) {
    console.error(`Error receiving webhook ${slug}:`, error);
    return context.json({ error: 'Failed to process webhook' }, 500);
  }
});

// Pages endpoints

// Type for page metadata stored in R2
type PageMetadata = {
  slug: string;
  brainRunId: string;
  persist: boolean;
  ttl?: number;
  createdAt: string;
};

/**
 * Generates a unique slug for pages that don't provide one.
 * Uses brainRunId prefix + random suffix for uniqueness.
 */
function generateUniqueSlug(brainRunId: string): string {
  const shortId = brainRunId.slice(0, 8);
  const random = Math.random().toString(36).substring(2, 10);
  return `page-${shortId}-${random}`;
}

// Create a new page
app.post('/pages', async (context: Context) => {
  try {
    const body = await context.req.json();
    let { slug, html, brainRunId, persist = false, ttl } = body;

    if (!html) {
      return context.json({ error: 'Missing required field "html"' }, 400);
    }
    if (!brainRunId) {
      return context.json({ error: 'Missing required field "brainRunId"' }, 400);
    }

    // Generate slug if not provided
    if (!slug) {
      slug = generateUniqueSlug(brainRunId);
    } else {
      // Validate slug format (alphanumeric, hyphens, underscores only)
      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return context.json(
          { error: 'Slug must contain only alphanumeric characters, hyphens, and underscores' },
          400
        );
      }
    }

    const bucket = context.env.RESOURCES_BUCKET;
    const key = `pages/${slug}.html`;
    const createdAt = new Date().toISOString();

    // Store HTML with metadata
    const metadata: PageMetadata = {
      slug,
      brainRunId,
      persist: persist === true,
      createdAt,
      ...(ttl !== undefined && { ttl: Number(ttl) }),
    };

    await bucket.put(key, html, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
      customMetadata: {
        slug,
        brainRunId,
        persist: persist === true ? 'true' : 'false',
        createdAt,
        ...(ttl !== undefined && { ttl: String(ttl) }),
      },
    });

    // Register the page with MonitorDO for cleanup tracking
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    await monitorStub.registerPage(slug, brainRunId, persist === true);

    // Build the public URL for this page
    const pageUrl = `${getOrigin(context)}/pages/${slug}`;

    return context.json(
      {
        slug,
        url: pageUrl,
        brainRunId,
        persist: persist === true,
        ...(ttl !== undefined && { ttl: Number(ttl) }),
        createdAt,
      },
      201
    );
  } catch (error) {
    console.error('Error creating page:', error);
    return context.json(
      {
        error: `Failed to create page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// List all pages
app.get('/pages', async (context: Context) => {
  const bucket = context.env.RESOURCES_BUCKET;

  try {
    const listed = await bucket.list({ prefix: 'pages/' });

    const pages = await Promise.all(
      listed.objects.map(async (object: R2Object) => {
        const r2Object = await bucket.head(object.key);

        if (!r2Object) {
          return null;
        }

        const metadata = r2Object.customMetadata || {};
        const slug = metadata.slug || object.key.replace('pages/', '').replace('.html', '');

        // Build the public URL
        const pageUrl = `${getOrigin(context)}/pages/${slug}`;

        return {
          slug,
          url: pageUrl,
          brainRunId: metadata.brainRunId || '',
          persist: metadata.persist === 'true',
          ...(metadata.ttl && { ttl: Number(metadata.ttl) }),
          createdAt: metadata.createdAt || object.uploaded.toISOString(),
          size: object.size,
        };
      })
    );

    // Filter out any null entries
    const validPages = pages.filter((page) => page !== null);

    return context.json({
      pages: validPages,
      count: validPages.length,
    });
  } catch (error) {
    console.error('Error listing pages:', error);
    return context.json(
      {
        error: `Failed to list pages: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Get page metadata (without content)
app.get('/pages/:slug/meta', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    const r2Object = await bucket.head(key);

    if (!r2Object) {
      return context.json({ error: 'Page not found' }, 404);
    }

    const metadata = r2Object.customMetadata || {};

    return context.json({
      slug: metadata.slug || slug,
      brainRunId: metadata.brainRunId || '',
      persist: metadata.persist === 'true',
      ...(metadata.ttl && { ttl: Number(metadata.ttl) }),
      createdAt: metadata.createdAt || r2Object.uploaded.toISOString(),
      size: r2Object.size,
    });
  } catch (error) {
    console.error(`Error getting page metadata for ${slug}:`, error);
    return context.json(
      {
        error: `Failed to get page metadata: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Get page HTML content
app.get('/pages/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    const r2Object = await bucket.get(key);

    if (!r2Object) {
      return context.json({ error: 'Page not found' }, 404);
    }

    const html = await r2Object.text();

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error(`Error getting page ${slug}:`, error);
    return context.json(
      {
        error: `Failed to get page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Update page HTML content
app.put('/pages/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    // Check if page exists and get its metadata
    const existingObject = await bucket.head(key);

    if (!existingObject) {
      return context.json({ error: 'Page not found' }, 404);
    }

    const body = await context.req.json();
    const { html } = body;

    if (!html) {
      return context.json({ error: 'Missing required field "html"' }, 400);
    }

    // Preserve existing metadata
    const existingMetadata = existingObject.customMetadata || {};

    // Update with new HTML, preserving metadata
    await bucket.put(key, html, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
      },
      customMetadata: existingMetadata,
    });

    // Build the public URL
    const pageUrl = `${getOrigin(context)}/pages/${slug}`;

    return context.json({
      slug,
      url: pageUrl,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error updating page ${slug}:`, error);
    return context.json(
      {
        error: `Failed to update page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Delete a page
app.delete('/pages/:slug', async (context: Context) => {
  const slug = context.req.param('slug');
  const bucket = context.env.RESOURCES_BUCKET;
  const key = `pages/${slug}.html`;

  try {
    // R2 delete is idempotent - no error if object doesn't exist
    await bucket.delete(key);

    // Also remove from MonitorDO tracking
    const monitorId = context.env.MONITOR_DO.idFromName('singleton');
    const monitorStub = context.env.MONITOR_DO.get(monitorId);
    await monitorStub.unregisterPage(slug);

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Error deleting page ${slug}:`, error);
    return context.json(
      {
        error: `Failed to delete page: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Secrets endpoints
// These use the Cloudflare API to manage Worker secrets

type CloudflareSecretResponse = {
  result: Array<{
    name: string;
    type: string;
  }>;
  success: boolean;
  errors: Array<{ message: string }>;
};

/**
 * Helper to check if Cloudflare API credentials are configured
 */
function getSecretsApiConfig(env: Bindings): { accountId: string; scriptName: string; apiToken: string } | null {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_SCRIPT_NAME } = env;

  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CF_SCRIPT_NAME) {
    return null;
  }

  return {
    accountId: CLOUDFLARE_ACCOUNT_ID,
    scriptName: CF_SCRIPT_NAME,
    apiToken: CLOUDFLARE_API_TOKEN,
  };
}

/**
 * Helper to make Cloudflare API requests for secrets
 */
async function cloudflareSecretsApi(
  config: { accountId: string; scriptName: string; apiToken: string },
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${config.scriptName}/secrets`;
  const url = path ? `${baseUrl}/${path}` : baseUrl;

  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// List all secrets (names only, not values)
app.get('/secrets', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  try {
    const response = await cloudflareSecretsApi(config, '');
    const data = await response.json() as CloudflareSecretResponse;

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to list secrets';
      return context.json({ error: errorMessage }, 500);
    }

    // Transform to match spec format - Cloudflare API doesn't return timestamps
    // so we use placeholder values
    const now = new Date().toISOString();
    const secrets = data.result.map((secret) => ({
      name: secret.name,
      createdAt: now,
      updatedAt: now,
    }));

    return context.json({
      secrets,
      count: secrets.length,
    });
  } catch (error) {
    console.error('Error listing secrets:', error);
    return context.json(
      {
        error: `Failed to list secrets: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Create or update a secret
app.post('/secrets', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  try {
    const body = await context.req.json();
    const { name, value } = body;

    if (!name) {
      return context.json({ error: 'Missing required field "name"' }, 400);
    }
    if (value === undefined) {
      return context.json({ error: 'Missing required field "value"' }, 400);
    }

    // Cloudflare API uses PUT with name in body (not in URL)
    const response = await cloudflareSecretsApi(config, '', {
      method: 'PUT',
      body: JSON.stringify({
        name,
        text: value,
        type: 'secret_text',
      }),
    });

    const data = await response.json() as { success: boolean; errors?: Array<{ message: string }> };

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to create secret';
      return context.json({ error: errorMessage }, 500);
    }

    const now = new Date().toISOString();
    return context.json(
      {
        name,
        createdAt: now,
        updatedAt: now,
      },
      201
    );
  } catch (error) {
    console.error('Error creating secret:', error);
    return context.json(
      {
        error: `Failed to create secret: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Delete a secret
app.delete('/secrets/:name', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  const name = decodeURIComponent(context.req.param('name'));

  try {
    const response = await cloudflareSecretsApi(config, encodeURIComponent(name), {
      method: 'DELETE',
    });

    const data = await response.json() as { success: boolean; errors?: Array<{ message: string }> };

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to delete secret';
      return context.json({ error: errorMessage }, 500);
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`Error deleting secret ${name}:`, error);
    return context.json(
      {
        error: `Failed to delete secret: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Check if a secret exists
app.get('/secrets/:name/exists', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  const name = decodeURIComponent(context.req.param('name'));

  try {
    // List all secrets and check if the name exists
    const response = await cloudflareSecretsApi(config, '');
    const data = await response.json() as CloudflareSecretResponse;

    if (!data.success) {
      const errorMessage = data.errors?.[0]?.message || 'Failed to check secret';
      return context.json({ error: errorMessage }, 500);
    }

    const exists = data.result.some((secret) => secret.name === name);

    return context.json({ exists });
  } catch (error) {
    console.error(`Error checking secret ${name}:`, error);
    return context.json(
      {
        error: `Failed to check secret: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

// Bulk create secrets
app.post('/secrets/bulk', async (context: Context) => {
  const config = getSecretsApiConfig(context.env);

  if (!config) {
    return context.json(
      {
        error: 'Secrets management not configured. Please set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CF_SCRIPT_NAME.',
      },
      400
    );
  }

  try {
    const body = await context.req.json();
    const { secrets } = body;

    if (!secrets || !Array.isArray(secrets)) {
      return context.json({ error: 'Missing required field "secrets" (array)' }, 400);
    }

    // First, get existing secrets to determine created vs updated
    const listResponse = await cloudflareSecretsApi(config, '');
    const listData = await listResponse.json() as CloudflareSecretResponse;

    const existingNames = new Set(
      listData.success ? listData.result.map((s) => s.name) : []
    );

    let created = 0;
    let updated = 0;

    // Create/update each secret
    for (const secret of secrets) {
      if (!secret.name || secret.value === undefined) {
        continue; // Skip invalid entries
      }

      const response = await cloudflareSecretsApi(config, '', {
        method: 'PUT',
        body: JSON.stringify({
          name: secret.name,
          text: secret.value,
          type: 'secret_text',
        }),
      });

      const data = await response.json() as { success: boolean };

      if (data.success) {
        if (existingNames.has(secret.name)) {
          updated++;
        } else {
          created++;
        }
      }
    }

    return context.json({ created, updated }, 201);
  } catch (error) {
    console.error('Error bulk creating secrets:', error);
    return context.json(
      {
        error: `Failed to bulk create secrets: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      },
      500
    );
  }
});

export default app;
