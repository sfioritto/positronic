import app from '../../src/api';
import { WorkflowRunnerDO } from '../../src/workflow-runner-do';

// Re-export the fetch handler from the imported Hono app
// and the Durable Object class
export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { WorkflowRunnerDO };
