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
  .step('Load text resource', ({ state, resources }) => ({
    ...state,
    text: resources['test-resource'] as string,
  }))
  .step('Load binary resource', ({ state, resources }) => ({
    ...state,
    buffer: (resources['test-resource-binary'] as Buffer).toString('base64'),
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
