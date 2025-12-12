import { brain, createWebhook } from '@positronic/core';
import { z } from 'zod';
import app from '../../src/api';
import {
  setManifest,
  BrainRunnerDO,
  setBrainRunner,
  setWebhookManifest,
} from '../../src/brain-runner-do';
import { MonitorDO } from '../../src/monitor-do';
import { ScheduleDO } from '../../src/schedule-do';
import { PositronicManifest } from '../../src/manifest.js';
import { runner } from './runner';

const basicBrain = brain({ title: 'basic-brain', description: 'A basic brain for testing' })
  .step('First step', ({ state }) => ({
    ...state,
    hello: 'Hello',
  }))
  .step('Second step', ({ state }) => ({
    ...state,
    world: 'World!',
  }))
  .step('Third step', ({ state }) => ({
    ...state,
    message: `${state.hello}, ${state.world}`,
  }));

const delayedBrain = brain({ title: 'delayed-brain', description: 'A brain that includes delays' })
  .step('Start Delay', async ({ state }) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { ...state, status_after_sleep: 'awake' };
  })
  .step('Finish', ({ state }) => ({
    ...state,
    final_message: 'Done after delay',
  }));

const resourceBrain = brain({ title: 'resource-brain', description: 'A brain that loads resources' })
  .step('Load text resource', async ({ state, resources }) => ({
    ...state,
    text: await (resources['testResource.txt'] as any).loadText(),
  }))
  .step('Load binary resource', async ({ state, resources }) => ({
    ...state,
    buffer: (
      await (resources['testResourceBinary.bin'] as any).loadBinary()
    ).toString('base64'),
  }))
  .step('Load nested resource', async ({ state, resources }) => ({
    ...state,
    nestedText: await (resources.nestedResource as any)[
      'testNestedResource.txt'
    ].loadText(),
  }));

// Brain that uses runtime options
const optionsBrain = brain({ title: 'options-brain', description: 'A brain that uses runtime options' })
  .withOptionsSchema(
    z.object({
      environment: z.string().default('development'),
      debug: z.string().optional(),
    })
  )
  .step('Process options', ({ state, options }) => ({
    ...state,
    environment: options.environment,
    debugMode: options.debug === 'true',
  }))
  .step('Use options', ({ state }) => ({
    ...state,
    message: `Running in ${state.environment} environment${state.debugMode ? ' with debug mode' : ''}`,
  }));

// Brain with title different from filename to test resolution
const titleTestBrain = brain({ title: 'Brain with Custom Title', description: 'Tests title vs filename resolution' })
  .step('First', ({ state }) => ({
    ...state,
    status: 'started',
  }))
  .step('Second', ({ state }) => ({
    ...state,
    status: 'completed',
  }));

// Test webhooks
const testWebhook = createWebhook(
  'test-webhook',
  z.object({
    message: z.string(),
    userId: z.string(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      type?: string;
      challenge?: string;
      threadId?: string;
      userId?: string;
      text?: string;
      message?: string;
      user?: string;
    };

    // Handle verification challenge (for testing verification flow)
    if (body.type === 'url_verification') {
      return {
        type: 'verification' as const,
        challenge: body.challenge!,
      };
    }

    // Normal webhook handling
    return {
      type: 'webhook' as const,
      identifier: body.threadId || body.userId || '',
      response: {
        message: body.text || body.message || '',
        userId: body.user || body.userId || '',
      },
    };
  }
);

const notificationWebhook = createWebhook(
  'notification',
  z.object({
    type: z.string(),
    data: z.string(),
    timestamp: z.number(),
  }),
  async (request: Request) => {
    const body = (await request.json()) as {
      notificationId: string;
      type: string;
      data: string;
    };
    return {
      type: 'webhook' as const,
      identifier: body.notificationId,
      response: {
        type: body.type,
        data: body.data,
        timestamp: Date.now(),
      },
    };
  }
);

// Brain that uses webhooks
const webhookBrain = brain({ title: 'webhook-brain', description: 'A brain that waits for webhooks' })
  .step('Send message and wait', ({ state }) => ({
    state: { ...state, waiting: true },
    waitFor: [testWebhook('test-thread-123')],
  }))
  .step('Process response', ({ state, response }) => ({
    ...state,
    waiting: false,
    receivedMessage: response.message,
    receivedUserId: response.userId,
  }));

// Brain that uses the pages service
const pagesBrain = brain({ title: 'pages-brain', description: 'A brain that creates and manages pages' })
  .step('Create page', async ({ state, pages }) => {
    const page = await pages!.create('test-page', '<html><body><h1>Hello World</h1></body></html>');
    return {
      ...state,
      pageSlug: page.slug,
      pageUrl: page.url,
      pageCreated: true,
    };
  })
  .step('Check page exists', async ({ state, pages }) => {
    const exists = await pages!.exists(state.pageSlug);
    return {
      ...state,
      pageExists: exists !== null,
    };
  })
  .step('Get page content', async ({ state, pages }) => {
    const html = await pages!.get(state.pageSlug);
    return {
      ...state,
      pageContent: html,
    };
  })
  .step('Update page', async ({ state, pages }) => {
    const updated = await pages!.update(state.pageSlug, '<html><body><h1>Updated!</h1></body></html>');
    return {
      ...state,
      pageUpdated: true,
      updatedAt: updated.createdAt,
    };
  });

// Brain that creates a persistent page
const persistentPageBrain = brain({ title: 'persistent-page-brain', description: 'A brain that creates a persistent page' })
  .step('Create persistent page', async ({ state, pages }) => {
    const page = await pages!.create('persistent-test', '<html><body>Persistent</body></html>', { persist: true });
    return {
      ...state,
      pageSlug: page.slug,
      pageUrl: page.url,
      persist: page.persist,
    };
  });

// Brain that creates a page without providing a slug (auto-generated)
const autoSlugBrain = brain({ title: 'auto-slug-brain', description: 'A brain that creates pages without explicit slugs' })
  .step('Create page without slug', async ({ state, pages }) => {
    // No slug provided - should auto-generate a unique one
    const page = await pages!.create('<html><body>Auto-generated slug page</body></html>');
    return {
      ...state,
      pageSlug: page.slug,
      pageUrl: page.url,
    };
  });

// Brain that creates a page with a fixed slug (reuses same page across runs)
let fixedSlugRunCount = 0;
const fixedSlugBrain = brain({ title: 'fixed-slug-brain', description: 'A brain that creates pages with explicit slugs' })
  .step('Create page with fixed slug', async ({ state, pages }) => {
    fixedSlugRunCount++;
    // Explicit slug provided - will overwrite if exists
    const page = await pages!.create('fixed-slug-page', `<html><body>Run ${fixedSlugRunCount}</body></html>`);
    return {
      ...state,
      pageSlug: page.slug,
      pageUrl: page.url,
      runNumber: fixedSlugRunCount,
    };
  });

const brainManifest = {
  'basic-brain': {
    filename: 'basic-brain',
    path: 'brains/basic-brain.ts',
    brain: basicBrain,
  },
  'delayed-brain': {
    filename: 'delayed-brain',
    path: 'brains/delayed-brain.ts',
    brain: delayedBrain,
  },
  'resource-brain': {
    filename: 'resource-brain',
    path: 'brains/resource-brain.ts',
    brain: resourceBrain,
  },
  'options-brain': {
    filename: 'options-brain',
    path: 'brains/options-brain.ts',
    brain: optionsBrain,
  },
  'title-test-brain': {
    filename: 'title-test-brain',
    path: 'brains/title-test-brain.ts',
    brain: titleTestBrain,
  },
  'webhook-brain': {
    filename: 'webhook-brain',
    path: 'brains/webhook-brain.ts',
    brain: webhookBrain,
  },
  'pages-brain': {
    filename: 'pages-brain',
    path: 'brains/pages-brain.ts',
    brain: pagesBrain,
  },
  'persistent-page-brain': {
    filename: 'persistent-page-brain',
    path: 'brains/persistent-page-brain.ts',
    brain: persistentPageBrain,
  },
  'auto-slug-brain': {
    filename: 'auto-slug-brain',
    path: 'brains/auto-slug-brain.ts',
    brain: autoSlugBrain,
  },
  'fixed-slug-brain': {
    filename: 'fixed-slug-brain',
    path: 'brains/fixed-slug-brain.ts',
    brain: fixedSlugBrain,
  },
};

const manifest = new PositronicManifest({
  manifest: brainManifest,
});

// Webhook manifest for discovery
export const webhookManifest = {
  'test-webhook': testWebhook,
  'notification': notificationWebhook,
};

setManifest(manifest);
setBrainRunner(runner);
setWebhookManifest(webhookManifest);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { BrainRunnerDO, MonitorDO, ScheduleDO };
