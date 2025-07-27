import { brain } from '@positronic/core';
import { z } from 'zod';
import app from '../../src/api';
import {
  setManifest,
  BrainRunnerDO,
  setBrainRunner,
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

const staticManifest = {
  'basic-brain': basicBrain,
  'delayed-brain': delayedBrain,
  'resource-brain': resourceBrain,
  'options-brain': optionsBrain,
};

const enhancedManifest = {
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
};

const manifest = new PositronicManifest({
  staticManifest,
  enhancedManifest,
});

setManifest(manifest);
setBrainRunner(runner);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { BrainRunnerDO, MonitorDO, ScheduleDO };
