import { DurableObject } from "cloudflare:workers";

export class WorkflowDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		console.log(`[WorkflowDO ${this.ctx.id}] Received fetch request: ${request.method} ${url.pathname}`);
		return new Response("WorkflowDO fetch handler reached", { status: 200 });
	}

	// TODO: Add WebSocket handlers (webSocketMessage, webSocketClose, webSocketError)
	// TODO: Add alarm handler (alarm)
	// TODO: Add helper methods (resetHibernationTimer, ensureWorkflowLoaded, etc.)
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const id: DurableObjectId = env.WORKFLOW_DO.idFromName("example-workflow-run");
		const stub = env.WORKFLOW_DO.get(id);
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;