import { workflow } from '@positronic/core';
import app from '../../src/api';
import {
  setManifest,
  BrainRunnerDO,
  setWorkflowRunner,
} from '../../src/brain-runner-do';
import { MonitorDO } from '../../src/monitor-do';
import { PositronicManifest } from '../../src/manifest.js';
import { runner } from './runner';

const basicWorkflow = workflow('basic-workflow')
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

const delayedWorkflow = workflow('delayed-workflow')
  .step('Start Delay', async ({ state }) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { ...state, status_after_sleep: 'awake' };
  })
  .step('Finish', ({ state }) => ({
    ...state,
    final_message: 'Done after delay',
  }));

const resourceWorkflow = workflow('resource-workflow')
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

const manifest = new PositronicManifest({
  staticManifest: {
    'basic-workflow': basicWorkflow,
    'delayed-workflow': delayedWorkflow,
    'resource-workflow': resourceWorkflow,
  },
});

setManifest(manifest);
setWorkflowRunner(runner);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { BrainRunnerDO, MonitorDO };
