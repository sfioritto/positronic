import { workflow } from '@positronic/core';
import app from '../../src/api';
import { setManifest, WorkflowRunnerDO } from '../../src/workflow-runner-do';

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


const inlineManifest = {
	'basic-workflow': basicWorkflow,
};

setManifest(inlineManifest);

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunnerDO };
