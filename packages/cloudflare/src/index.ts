import { DurableObject } from "cloudflare:workers";
// Assuming core types are exported from the core package
import { Workflow, WorkflowRunner, Adapter, PromptClient, WorkflowEvent } from "@positronic/core";

// --- Placeholder Implementations ---

class D1Adapter implements Adapter {
	dispatch(event: WorkflowEvent): Promise<void> {
		console.log(`[D1Adapter] Received event: ${event.type}`);
		// TODO: Implement D1 persistence logic
		return Promise.resolve();
	}
}

class WebSocketAdapter implements Adapter {
	dispatch(event: WorkflowEvent): Promise<void> {
		console.log(`[WebSocketAdapter] Received event: ${event.type}`);
		// TODO: Implement WebSocket broadcasting logic
		return Promise.resolve();
	}
}

class DummyPromptClient implements PromptClient {
	execute<T>(prompt: string, responseModel: any): Promise<T> {
		console.log(`[DummyPromptClient] Executing prompt (returning dummy data): ${prompt}`);
		// TODO: Replace with actual LLM client logic
		return Promise.resolve({ dummy: "data" } as T);
	}
}

// TODO: Replace with actual workflow definitions/loading mechanism
const workflowRegistry: { [key: string]: Workflow<any, any, any> } = {
	// Example: assumes a workflow named 'hello' is defined somewhere
	// import helloWorkflow from './workflows/hello';
	// hello: helloWorkflow
};

// --- Durable Object ---

export class WorkflowDO extends DurableObject<Env> {
	private workflowRunId?: string;
	private runner?: WorkflowRunner;
	private adapters: Adapter[] = [];
	private promptClient: PromptClient;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Instantiate adapters and clients that rely on env bindings here
		// TODO: Pass actual env bindings (like env.DB) to adapters
		this.adapters = [
			new D1Adapter(),
			new WebSocketAdapter()
		];
		this.promptClient = new DummyPromptClient(); // TODO: Use actual client
		this.runner = new WorkflowRunner({
			adapters: this.adapters,
			logger: console, // Use console for logging for now
			verbose: true, // Or configure based on env/request
			client: this.promptClient
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		console.log(`[WorkflowDO ${this.ctx.id}] Received fetch request: ${request.method} ${url.pathname}`);

		if (url.pathname === "/init" && request.method === "POST") {
			try {
				const initData = await request.json<{ workflowRunId: string; workflowName: string; }>();

				if (!initData.workflowRunId || !initData.workflowName) {
					return new Response("Missing workflowRunId or workflowName in request body", { status: 400 });
				}

				this.workflowRunId = initData.workflowRunId;
				console.log(`[WorkflowDO ${this.ctx.id}] Initialized with run ID: ${this.workflowRunId}`);

				// Load workflow definition
				const workflowToRun = workflowRegistry[initData.workflowName];
				if (!workflowToRun) {
					console.error(`[WorkflowDO ${this.ctx.id}] Workflow not found: ${initData.workflowName}`);
					return new Response(`Workflow '${initData.workflowName}' not found`, { status: 404 });
				}

				// Start workflow run (don't await completion, let it run in background)
				if (this.runner) {
					this.runner.run(workflowToRun, {
						workflowRunId: this.workflowRunId
						// TODO: Pass options if needed
					}).catch(err => {
						// Log errors from the background run
						console.error(`[WorkflowDO ${this.ctx.id}] Error during background workflow run ${this.workflowRunId}: ${err.message}`);
					});
				} else {
					console.error(`[WorkflowDO ${this.ctx.id}] WorkflowRunner not initialized!`);
					return new Response("Internal Server Error: Runner not available", { status: 500 });
				}

				// TODO: Set hibernation timer (this.resetHibernationTimer())

				return new Response("WorkflowDO initialized successfully, run started.", { status: 200 });
			} catch (error: any) {
				console.error(`[WorkflowDO ${this.ctx.id}] Error during /init: ${error.message}`)
				return new Response("Failed to initialize WorkflowDO", { status: 500 });
			}
		}

		// Handle other paths or methods (e.g., WebSocket upgrade)
		// TODO: Add WebSocket upgrade logic

		return new Response("Not Found or Method Not Allowed", { status: 404 });
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