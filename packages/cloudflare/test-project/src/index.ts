import app from '../../src/api';
import { setRuntimeManifest, WorkflowRunnerDO } from '../../src/workflow-runner-do';

function helloWorld(name: string = "World"): string {
	console.log("[test-project] helloWorld function executed!");
	return `Hello, ${name}! from test project function.`;
}

const inlineManifest = {
	'my-test-workflow': helloWorld,
};

setRuntimeManifest(inlineManifest);

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunnerDO };
