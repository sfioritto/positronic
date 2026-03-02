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
  .step('Prepare', ({ state }) => ({
    ...state, waiting: true,
  }))
  .wait('Wait for webhook', () => testWebhook('test-thread-123'))
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
  .step('Prepare inner wait', ({ state }) => ({
    ...state, waiting: true,
  }))
  .wait('Wait for inner webhook', () => innerWebhook('inner-test-id'))
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
  .step('Prepare webhook wait', ({ state }) => ({
    ...state, waitingForWebhook: true,
  }))
  .wait('Wait for webhook', () => testWebhook('outer-status-test'))
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

// Brain that creates a non-persistent page and waits for a webhook (for testing page cleanup on kill)
const pageWebhookBrain = brain({ title: 'page-webhook-brain', description: 'A brain that creates a page and waits for a webhook' })
  .step('Create page', async ({ state, pages }) => {
    // Create a non-persistent page (default behavior)
    const page = await pages!.create('<html><body><h1>Page for webhook test</h1></body></html>');
    return {
      ...state,
      pageSlug: page.slug,
      pageUrl: page.url,
    };
  })
  .step('Prepare webhook wait', ({ state }) => ({
    ...state, waiting: true,
  }))
  .wait('Wait for webhook', () => testWebhook('page-webhook-test'))
  .step('After webhook', ({ state, response }) => ({
    ...state,
    waiting: false,
    webhookResponse: response,
  }));

// Brain with an agent step that uses webhooks for escalation
const agentWebhookBrain = brain({ title: 'agent-webhook-brain', description: 'A brain that uses agent with webhook escalation' })
  .brain('Process with escalation', ({ state }) => ({
    system: 'You are an AI assistant that can escalate to humans when needed.',
    prompt: 'Please process this request. If you need human review, use the escalate tool.',
    tools: {
      escalate: {
        description: 'Escalate to a human for review',
        inputSchema: z.object({
          reason: z.string().describe('Why escalation is needed'),
        }),
        execute: async () => {
          // Return waitFor to suspend the agent and wait for webhook
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

// Brain with an agent step that will trigger an API error (simulates "too many tokens")
// The mock client can be configured to throw an error via setMockError()
const agentErrorBrain = brain({ title: 'agent-error-brain', description: 'A brain that triggers an API error in its agent step' })
  .brain('Process request', ({ state }) => ({
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

// Brain that generates a large state (> 1MB) to test R2 overflow
// Note: The large data is generated in a way that the serialized event exceeds R2_OVERFLOW_THRESHOLD
const largeStateBrain = brain({ title: 'large-state-brain', description: 'A brain that generates large state for R2 overflow testing' })
  .step('Generate small state', ({ state }) => ({
    ...state,
    smallData: 'This is a small initial value',
  }))
  .step('Generate large state', ({ state }) => {
    // Generate a string that's > 1MB (1,048,576 bytes)
    // The entire serialized event (including type, brainRunId, etc.) needs to exceed threshold
    const largeString = 'X'.repeat(1.1 * 1024 * 1024); // ~1.1MB of data
    return {
      ...state,
      largeData: largeString,
    };
  })
  .step('Final step', ({ state }) => ({
    ...state,
    completed: true,
    // Clear the large data to avoid keeping it in final state
    largeData: 'cleared',
  }));

// Brain with large state that pauses for webhook - for testing R2 overflow with resume
const largeStateWebhookBrain = brain({ title: 'large-state-webhook-brain', description: 'A brain with large state that waits for webhooks' })
  .step('Generate large state', ({ state }) => {
    // Generate a string that's > 1MB
    const largeString = 'Y'.repeat(1.1 * 1024 * 1024); // ~1.1MB
    return {
      ...state,
      largeData: largeString,
    };
  })
  .step('Prepare webhook wait', ({ state }) => ({
    ...state, waiting: true,
  }))
  .wait('Wait for webhook', () => testWebhook('large-state-test'))
  .step('After webhook', ({ state, response }) => ({
    ...state,
    waiting: false,
    webhookReceived: true,
    responseMessage: response?.message,
    // Clear large data after webhook
    largeData: 'cleared',
  }));

// Brain that does batch processing followed by a webhook wait.
// Tests that alarm-based DO restart (for batch chunk processing) preserves the brainRunId
// so that MonitorDO can correctly track state and validate webhook responses.
const batchWebhookBrain = brain({ title: 'batch-webhook-brain', description: 'Batch processing followed by webhook' })
  .step('Init items', ({ state }) => ({
    ...state,
    items: ['item-a', 'item-b', 'item-c'],
  }))
  .prompt(
    'Process items',
    {
      template: (item: string) => `Process: ${item}`,
      outputSchema: {
        schema: z.object({ result: z.string() }),
        name: 'batchResults' as const,
      },
    },
    {
      over: (state) => state.items,
      concurrency: 2,
    }
  )
  .step('Prepare webhook wait', ({ state }) => ({
    ...state, waiting: true,
  }))
  .wait('Wait for webhook', () => testWebhook('batch-webhook-test'))
  .step('Process webhook response', ({ state, response }) => ({
    ...state,
    waiting: false,
    webhookMessage: response.message,
  }));

// Brain with a single wait step that has a timeout
const timeoutWebhookBrain = brain({ title: 'timeout-webhook-brain', description: 'A brain that waits for a webhook with a timeout' })
  .step('Prepare', ({ state }) => ({
    ...state, waiting: true,
  }))
  .wait('Wait for webhook', () => testWebhook('timeout-test-123'), { timeout: '1h' })
  .step('Process response', ({ state, response }) => ({
    ...state,
    waiting: false,
    receivedMessage: response.message,
  }));

// Brain with two sequential waits, each with a timeout
const multiWaitBrain = brain({ title: 'multi-wait-brain', description: 'A brain with two sequential waits with timeouts' })
  .step('Init', ({ state }) => ({ ...state, step: 1 }))
  .wait('Wait 1', () => testWebhook('multi-wait-1'), { timeout: '1h' })
  .step('After wait 1', ({ state, response }) => ({ ...state, step: 2, msg1: response.message }))
  .wait('Wait 2', () => testWebhook('multi-wait-2'), { timeout: '2h' })
  .step('After wait 2', ({ state, response }) => ({ ...state, step: 3, msg2: response.message }));

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
  'page-webhook-brain': {
    filename: 'page-webhook-brain',
    path: 'brains/page-webhook-brain.ts',
    brain: pageWebhookBrain,
  },
  'agent-webhook-brain': {
    filename: 'agent-webhook-brain',
    path: 'brains/agent-webhook-brain.ts',
    brain: agentWebhookBrain,
  },
  'agent-error-brain': {
    filename: 'agent-error-brain',
    path: 'brains/agent-error-brain.ts',
    brain: agentErrorBrain,
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
  'large-state-brain': {
    filename: 'large-state-brain',
    path: 'brains/large-state-brain.ts',
    brain: largeStateBrain,
  },
  'large-state-webhook-brain': {
    filename: 'large-state-webhook-brain',
    path: 'brains/large-state-webhook-brain.ts',
    brain: largeStateWebhookBrain,
  },
  'batch-webhook-brain': {
    filename: 'batch-webhook-brain',
    path: 'brains/batch-webhook-brain.ts',
    brain: batchWebhookBrain,
  },
  'timeout-webhook-brain': {
    filename: 'timeout-webhook-brain',
    path: 'brains/timeout-webhook-brain.ts',
    brain: timeoutWebhookBrain,
  },
  'multi-wait-brain': {
    filename: 'multi-wait-brain',
    path: 'brains/multi-wait-brain.ts',
    brain: multiWaitBrain,
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
