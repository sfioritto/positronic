import { brain } from '@positronic/core';
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
// Import webhooks from webhooks/ directory (simulates auto-discovery pattern)
import testWebhook from '../webhooks/test-webhook.js';
import innerWebhook from '../webhooks/inner-webhook.js';
import loopEscalationWebhook from '../webhooks/loop-escalation.js';
// Import the webhook manifest (simulates generated _webhookManifest.ts)
import { webhookManifest } from './_webhookManifest.js';

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

// Inner brain with a webhook - for testing nested brain webhook resume
const innerWebhookBrain = brain<{ data: string }, { count: number }>({
  title: 'inner-webhook-brain-inner',
  description: 'Inner brain that waits for webhooks',
})
  .step('Inner step 1', ({ state }) => ({ count: state.count + 1 }))
  .step('Wait for inner webhook', ({ state }) => ({
    state: { ...state, waiting: true },
    waitFor: [innerWebhook('inner-test-id')],
  }))
  .step('Process inner webhook', ({ state, response }) => ({
    ...state,
    waiting: false,
    webhookData: response?.data || 'no-data',
    processed: true,
  }));

// Outer brain containing inner brain with webhook
const outerInnerWebhookBrain = brain({
  title: 'inner-webhook-brain',
  description: 'Outer brain containing inner brain with webhook',
})
  .step('Outer step 1', () => ({ prefix: 'outer-' }))
  .brain(
    'Run inner brain',
    innerWebhookBrain,
    ({ state, brainState }) => ({
      ...state,
      innerResult: brainState,
    }),
    () => ({ count: 0 })
  )
  .step('Outer step 2', ({ state }) => ({
    ...state,
    done: true,
  }));

// Simple inner brain that completes immediately - for testing status reporting
const simpleInnerBrain = brain<{}, { innerDone: boolean }>({
  title: 'simple-inner-brain',
  description: 'Inner brain that completes immediately',
})
  .step('Inner work', () => ({ innerDone: true }));

// Outer brain with webhook AFTER inner brain - for testing that inner brain COMPLETE
// does not prematurely mark the outer brain as complete
const outerWebhookAfterInner = brain({
  title: 'outer-webhook-after-inner',
  description: 'Outer brain with webhook after inner brain completes',
})
  .step('Outer step 1', () => ({ started: true }))
  .brain(
    'Run inner brain',
    simpleInnerBrain,
    ({ state, brainState }) => ({ ...state, innerResult: brainState }),
    () => ({})
  )
  .step('Wait for webhook', ({ state }) => ({
    state: { ...state, waitingForWebhook: true },
    waitFor: [testWebhook('outer-status-test')],
  }))
  .step('After webhook', ({ state }) => ({ ...state, complete: true }));

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

// Brain with a loop step that uses webhooks for escalation
const loopWebhookBrain = brain({ title: 'loop-webhook-brain', description: 'A brain that uses loop with webhook escalation' })
  .loop('Process with escalation', ({ state }) => ({
    system: 'You are an AI assistant that can escalate to humans when needed.',
    prompt: 'Please process this request. If you need human review, use the escalate tool.',
    tools: {
      escalate: {
        description: 'Escalate to a human for review',
        inputSchema: z.object({
          reason: z.string().describe('Why escalation is needed'),
        }),
        execute: async () => {
          // Return waitFor to suspend the loop and wait for webhook
          return {
            waitFor: loopEscalationWebhook('test-escalation-123'),
          };
        },
      },
      finish: {
        description: 'Complete the task with a final result',
        inputSchema: z.object({
          result: z.string().describe('The final result'),
        }),
        terminal: true,
      },
    },
  }));

// Brain with a loop step that will trigger an API error (simulates "too many tokens")
// The mock client can be configured to throw an error via setMockError()
const loopErrorBrain = brain({ title: 'loop-error-brain', description: 'A brain that triggers an API error in its loop step' })
  .loop('Process request', ({ state }) => ({
    system: 'You are a helpful assistant.',
    prompt: 'Please process this request.',
    tools: {
      finish: {
        description: 'Complete the task',
        inputSchema: z.object({
          result: z.string().describe('The final result'),
        }),
        terminal: true,
      },
    },
  }));

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
  'loop-webhook-brain': {
    filename: 'loop-webhook-brain',
    path: 'brains/loop-webhook-brain.ts',
    brain: loopWebhookBrain,
  },
  'loop-error-brain': {
    filename: 'loop-error-brain',
    path: 'brains/loop-error-brain.ts',
    brain: loopErrorBrain,
  },
  'inner-webhook-brain': {
    filename: 'inner-webhook-brain',
    path: 'brains/inner-webhook-brain.ts',
    brain: outerInnerWebhookBrain,
  },
  'outer-webhook-after-inner': {
    filename: 'outer-webhook-after-inner',
    path: 'brains/outer-webhook-after-inner.ts',
    brain: outerWebhookAfterInner,
  },
};

const manifest = new PositronicManifest({
  manifest: brainManifest,
});

setManifest(manifest);
setBrainRunner(runner);
setWebhookManifest(webhookManifest);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { BrainRunnerDO, MonitorDO, ScheduleDO };
