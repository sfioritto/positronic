import { workflow } from '@positronic/core';
import app from '../../src/api';
import { setManifest, WorkflowRunnerDO } from '../../src/workflow-runner-do';
import { MonitorDO } from '../../src/monitor-do';
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

// Define the new delayed workflow
const delayedWorkflow = workflow('delayed-workflow')
.step('Start Delay', async ({ state }) => {
	// Simulate a 1.5 second delay using standard setTimeout
	await new Promise(resolve => setTimeout(resolve, 1500));
	return { ...state, status_after_sleep: 'awake' };
})
.step('Finish', ({ state }) => ({
	...state,
	final_message: 'Done after delay',
}));


const inlineManifest = {
	'basic-workflow': basicWorkflow,
	'delayed-workflow': delayedWorkflow, // Add the delayed workflow to the manifest
};

setManifest(inlineManifest);

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunnerDO, MonitorDO };
