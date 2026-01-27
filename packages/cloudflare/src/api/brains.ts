import { Hono, type Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { parseCronExpression } from 'cron-schedule';
import Fuse from 'fuse.js';
import { isSignalValid, brainMachineDefinition } from '@positronic/core';
import { getManifest } from '../brain-runner-do.js';
import type { Bindings, CreateBrainRunRequest, CreateBrainRunResponse } from './types.js';

const brains = new Hono<{ Bindings: Bindings }>();

brains.post('/runs', async (context: Context) => {
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

brains.post('/runs/rerun', async (context: Context) => {
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

brains.get('/runs/:runId/watch', async (context: Context) => {
  const runId = context.req.param('runId');
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(runId);
  const stub = namespace.get(doId);
  const response = await stub.fetch(new Request(`http://do/watch`));
  return response;
});

brains.get('/runs/:runId', async (context: Context) => {
  const runId = context.req.param('runId');

  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const run = await monitorStub.getRun(runId);

  if (!run) {
    return context.json({ error: `Brain run '${runId}' not found` }, 404);
  }

  return context.json(run);
});

brains.delete('/runs/:runId', async (context: Context) => {
  const runId = context.req.param('runId');

  // First check if the run exists in the monitor
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const existingRun = await monitorStub.getLastEvent(runId);

  if (!existingRun) {
    return context.json({ error: `Brain run '${runId}' not found` }, 404);
  }

  // Now try to kill it - pass runId and brainTitle as fallbacks in case
  // the DO's SQLite state is missing (zombie brain scenario)
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(runId);
  const stub = namespace.get(doId);

  try {
    const result = await stub.kill(runId, existingRun.brain_title);

    if (!result.success) {
      return context.json({ error: result.message }, 409);
    }

    // Return 204 No Content on success
    return new Response(null, { status: 204 });
  } catch (error: any) {
    console.error(`Error killing brain run ${runId}:`, error);
    return context.json({ error: 'Failed to kill brain run' }, 500);
  }
});

// Signal endpoint - queue KILL, PAUSE, USER_MESSAGE, RESUME, or WEBHOOK_RESPONSE signals
brains.post('/runs/:runId/signals', async (context: Context) => {
  const runId = context.req.param('runId');
  const body = await context.req.json<{ type: string; content?: string; response?: Record<string, unknown> }>();

  // Validate signal type
  if (!['KILL', 'PAUSE', 'USER_MESSAGE', 'RESUME', 'WEBHOOK_RESPONSE'].includes(body.type)) {
    return context.json({ error: 'Invalid signal type' }, 400);
  }

  // Check if the run exists in MonitorDO
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const run = await monitorStub.getRun(runId);

  if (!run) {
    return context.json({ error: 'Brain run not found' }, 404);
  }

  // Validate control signals against current brain state using state machine definition
  // USER_MESSAGE is a data signal that gets queued and processed during agent execution,
  // so it doesn't need state validation - it can always be queued
  if (body.type !== 'USER_MESSAGE') {
    const validation = isSignalValid(brainMachineDefinition, run.status, body.type);
    if (!validation.valid) {
      return context.json({ error: validation.reason }, 409);
    }
  }

  // Get BrainRunnerDO stub and queue the signal
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(runId);
  const stub = namespace.get(doId);

  const signal = await stub.queueSignal(body);

  // For RESUME signals, also wake up the brain since it's not actively polling when paused
  if (body.type === 'RESUME') {
    await stub.wakeUp(runId);
  }

  return context.json({
    success: true,
    signal: { type: signal.type, queuedAt: signal.queuedAt }
  }, 202);
});

// Resume endpoint - resume a paused brain using signal-based approach
brains.post('/runs/:runId/resume', async (context: Context) => {
  const runId = context.req.param('runId');

  // Check if the run exists and is paused via MonitorDO
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const run = await monitorStub.getRun(runId);

  if (!run) {
    return context.json({ error: 'Brain run not found' }, 404);
  }

  if (run.status !== 'paused') {
    return context.json({
      error: `Cannot resume brain in '${run.status}' state. Only paused brains can be resumed.`
    }, 409);
  }

  // Queue RESUME signal and wake up the brain
  const namespace = context.env.BRAIN_RUNNER_DO;
  const doId = namespace.idFromName(runId);
  const stub = namespace.get(doId);

  // Queue the RESUME signal first, then wake up the brain
  await stub.queueSignal({ type: 'RESUME' });
  await stub.wakeUp(runId);

  return context.json({ success: true, action: 'resumed' }, 202);
});

brains.get('/:identifier/history', async (context: Context) => {
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

brains.get('/:identifier/active-runs', async (context: Context) => {
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

brains.get('/watch', async (context: Context) => {
  const monitorId = context.env.MONITOR_DO.idFromName('singleton');
  const monitorStub = context.env.MONITOR_DO.get(monitorId);
  const response = await monitorStub.fetch(new Request(`http://do/watch`));
  return response;
});

brains.get('/', async (context: Context) => {
  const manifest = getManifest();

  if (!manifest) {
    return context.json({ error: 'Manifest not initialized' }, 500);
  }

  const query = context.req.query('q')?.trim();

  const brainFilenames = manifest.list();
  const brainList = await Promise.all(
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
  const validBrains = brainList.filter(brain => brain !== null);

  // If no query, return all brains
  if (!query) {
    return context.json({
      brains: validBrains,
      count: validBrains.length,
    });
  }

  // Check for exact match on title or filename first
  const queryLower = query.toLowerCase();
  const exactMatch = validBrains.find(
    brain =>
      brain.title.toLowerCase() === queryLower ||
      brain.filename.toLowerCase() === queryLower
  );

  if (exactMatch) {
    return context.json({
      brains: [exactMatch],
      count: 1,
    });
  }

  // Use fuse.js for fuzzy matching with weighted keys
  const fuse = new Fuse(validBrains, {
    keys: [
      { name: 'title', weight: 2 },
      { name: 'filename', weight: 2 },
      { name: 'description', weight: 0.5 },
    ],
    includeScore: true,
    threshold: 0.4, // Lower = stricter matching
    ignoreLocation: true, // Match anywhere in the string
  });

  const results = fuse.search(query);

  // If no results, return empty
  if (results.length === 0) {
    return context.json({
      brains: [],
      count: 0,
    });
  }

  // If top result is significantly better than others (score difference > 0.2),
  // or there's only one result, return just that one
  if (
    results.length === 1 ||
    (results.length > 1 && results[1].score! - results[0].score! > 0.2)
  ) {
    return context.json({
      brains: [results[0].item],
      count: 1,
    });
  }

  // Return all matching results, sorted by score (best first)
  return context.json({
    brains: results.map(r => r.item),
    count: results.length,
  });
});

// Schedule endpoints

// Create a new schedule
brains.post('/schedules', async (context: Context) => {
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
brains.get('/schedules', async (context: Context) => {
  const scheduleId = context.env.SCHEDULE_DO.idFromName('singleton');
  const scheduleStub = context.env.SCHEDULE_DO.get(scheduleId);

  const result = await scheduleStub.listSchedules();
  return context.json(result);
});

// Get scheduled run history - MUST be before :scheduleId route
brains.get('/schedules/runs', async (context: Context) => {
  const scheduleIdParam = context.req.query('scheduleId');
  const limit = Number(context.req.query('limit') || '100');

  const scheduleDoId = context.env.SCHEDULE_DO.idFromName('singleton');
  const scheduleStub = context.env.SCHEDULE_DO.get(scheduleDoId);

  const result = await scheduleStub.getAllRuns(scheduleIdParam, limit);
  return context.json(result);
});

// Delete a schedule
brains.delete('/schedules/:scheduleId', async (context: Context) => {
  const scheduleIdParam = context.req.param('scheduleId');

  const scheduleDoId = context.env.SCHEDULE_DO.idFromName('singleton');
  const scheduleStub = context.env.SCHEDULE_DO.get(scheduleDoId);

  const deleted = await scheduleStub.deleteSchedule(scheduleIdParam);

  if (!deleted) {
    return context.json({ error: 'Schedule not found' }, 404);
  }

  return new Response(null, { status: 204 });
});

brains.get('/:identifier', async (context: Context) => {
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

export default brains;
