import { z } from "zod";
import { AnthropicClient } from "../clients/anthropic";
import type { PromptClient } from "../types";
import type { JsonObject, SerializedError } from "./types";
import { STATUS, WORKFLOW_EVENTS } from './constants';
import { addFetch } from './fetch';

export type Context = JsonObject;

export interface Event<
  TContextIn extends Context,
  TContextOut extends Context,
  TOptions extends object = {}
> {
  workflowTitle: string;
  workflowDescription?: string;
  type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS];
  status: typeof STATUS[keyof typeof STATUS];
  previousContext: TContextIn;
  newContext: TContextOut;
  error?: SerializedError;
  completedStep?: SerializedStep;
  steps: SerializedStep[];
  options: TOptions;
}

interface SerializedStep {
  title: string;
  status: typeof STATUS[keyof typeof STATUS];
  context: Context;
}

export type StepBlock<TContextIn, TContextOut> = {
  type: 'step';
  title: string;
  execute: (ctx: TContextIn) => TContextOut | Promise<TContextOut>;
};

type WorkflowBlock<TOuterContext, TInnerContext extends Context, TNewContext> = {
  type: 'workflow';
  title: string;
  innerWorkflow: Workflow<TInnerContext>;
  initialContext: TInnerContext | ((outerCtx: TOuterContext) => TInnerContext);
  reducer: (outerCtx: TOuterContext, innerCtx: TInnerContext) => TNewContext;
};

type Block<TContextIn, TContextOut> =
  | StepBlock<TContextIn, TContextOut>
  | WorkflowBlock<TContextIn, any, TContextOut>;

interface RunParams<
  TOptions extends object = {},
  TContextIn extends Context = Context
> {
  initialContext?: TContextIn;
  options?: TOptions;
  initialCompletedSteps?: SerializedStep[];
}

export class Workflow<TContext extends Context = {}> {
  private blocks: Block<any, any>[] = [];
  private defaultClient: PromptClient;

  constructor(defaultClient: PromptClient) {
    this.defaultClient = defaultClient;
  }

  step<TNewContext extends Context>(
    title: string,
    fn: (ctx: TContext) => TNewContext | Promise<TNewContext>
  ) {
    const stepBlock: StepBlock<TContext, TNewContext> = {
      type: 'step',
      title,
      execute: fn
    };
    this.blocks.push(stepBlock);
    return new Workflow<TNewContext>(this.defaultClient).withBlocks(this.blocks);
  }

  workflow<TInnerContext extends Context, TNewContext extends Context>(
    title: string,
    innerWorkflow: Workflow<TInnerContext>,
    reducer: (params: { context: TContext, workflowContext: TInnerContext }) => TNewContext,
    initialContext?: TInnerContext | ((context: TContext) => TInnerContext)
  ) {
    const nestedBlock: WorkflowBlock<TContext, TInnerContext, TNewContext> = {
      type: 'workflow',
      title,
      innerWorkflow,
      initialContext: initialContext || (() => ({} as TInnerContext)),
      reducer: (outerCtx, innerCtx) => reducer({ context: outerCtx, workflowContext: innerCtx})
    };
    this.blocks.push(nestedBlock);
    return new Workflow<TNewContext>(this.defaultClient).withBlocks(this.blocks);
  }

  prompt<TResponseKey extends string, TSchema extends z.ZodObject<any>>(
    title: string,
    config: {
      template: (ctx: TContext) => string;
      responseModel: {
        schema: TSchema;
        name: TResponseKey;
      };
      client?: PromptClient;
    }
  ): Workflow<TContext & { [K in TResponseKey]: z.infer<TSchema> }> {
    const promptBlock: StepBlock<
      TContext,
      TContext & { [K in TResponseKey]: z.infer<TSchema> }
    > = {
      type: 'step',
      title,
      execute: async (ctx) => {
        const client = config.client ?? this.defaultClient;
        const promptString = config.template(ctx);
        const response = await client.execute(promptString, config.responseModel);

        return {
          ...ctx,
          [config.responseModel.name]: response
        };
      }
    };
    this.blocks.push(promptBlock);
    return new Workflow<
      TContext & { [K in TResponseKey]: z.infer<TSchema> }
    >(this.defaultClient).withBlocks(this.blocks);
  }

  private withBlocks(blocks: Block<any, any>[]): this {
    this.blocks = blocks;
    return this;
  }

  async *run(params: RunParams<{}, TContext> = {}): AsyncGenerator<Event<TContext, TContext>> {
    let currentContext = structuredClone(params.initialContext || {}) as TContext;
    const completedSteps: SerializedStep[] = [...(params.initialCompletedSteps || [])];

    if (completedSteps.length > 0) {
      currentContext = structuredClone(completedSteps[completedSteps.length - 1].context) as TContext;
    }

    // Rest of the implementation remains similar, but add options to events:
    yield {
      type: completedSteps.length > 0 ? 'workflow:restart' : 'workflow:start',
      status: STATUS.RUNNING,
      workflowTitle: this.blocks[0]?.title ?? 'Untitled Workflow',
      previousContext: currentContext,
      newContext: currentContext,
      steps: this.blocks.map(block => ({
        title: block.title,
        status: STATUS.PENDING,
        context: currentContext
      })),
      options: params.options || {}
    };

    // Process each block
    for (const block of this.blocks) {
      const previousContext = structuredClone(currentContext);
      try {
        if (block.type === 'step') {
          currentContext = await block.execute(currentContext);
        } else if (block.type === 'workflow') {
          const childInitial = typeof block.initialContext === 'function'
            ? block.initialContext(currentContext)
            : block.initialContext;
          const innerCtx = await block.innerWorkflow.run(childInitial);
          currentContext = block.reducer(currentContext, innerCtx);
        }

        const completedStep = {
          title: block.title,
          status: STATUS.COMPLETE,
          context: currentContext
        };
        completedSteps.push(completedStep);

        // Yield update event
        yield {
          type: 'workflow:update',
          status: STATUS.RUNNING,
          workflowTitle: this.blocks[0]?.title ?? 'Untitled Workflow',
          previousContext,
          newContext: currentContext,
          completedStep,
          steps: this.blocks.map((b, i) =>
            completedSteps[i] || {
              title: b.title,
              status: 'PENDING',
              context: currentContext
            }
          ),
          options: params.options || {}
        };
      } catch (error) {
        const errorStep = {
          title: block.title,
          status: STATUS.ERROR,
          context: currentContext
        };
        completedSteps.push(errorStep);

        // Yield error event
        yield {
          type: 'workflow:error',
          status: STATUS.ERROR,
          workflowTitle: this.blocks[0]?.title ?? 'Untitled Workflow',
          previousContext,
          newContext: currentContext,
          completedStep: errorStep,
          error: error as SerializedError,
          steps: this.blocks.map((b, i) =>
            completedSteps[i] || {
              title: b.title,
              status: 'PENDING',
              context: currentContext
            }
          ),
          options: params.options || {}
        };
        throw error;
      }
    }

    // Yield complete event
    yield {
      type: 'workflow:complete',
      status: STATUS.COMPLETE,
      workflowTitle: this.blocks[0]?.title ?? 'Untitled Workflow',
      previousContext: params.initialContext || {} as TContext,
      newContext: currentContext,
      steps: completedSteps,
      options: params.options || {}
    };

    return currentContext;
  }
}

addFetch();

const client = new AnthropicClient();

const workflow = new Workflow(client)
  .step('Get User name', (ctx) => {
    return {
      ...ctx,
      user: 'bob'
    };
  })
  .fetch('Get User Data', {
    url: (ctx) => `https://api.example.com/users/${ctx.user}`,
    schema: z.object({
      name: z.string(),
      age: z.number(),
      email: z.string().email()
    })
  })
  .step("Uppercase user name", (ctx) => {
    return {
      ...ctx,
      user: ctx.user.toUpperCase()
    };
  });



// Type testing
type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;

// Expected final context type for our example workflow
type ExpectedWorkflowContext = {
  user: string;
  name: string;
  age: number;
  email: string;
};

// Extract the context type from the workflow
type ExtractContextType<T> = T extends Workflow<infer Context> ? Context : never;

type TestFinalContext = ExtractContextType<typeof workflow>;

// This will show a type error if the types don't match
type TestResult = AssertEquals<TestFinalContext, ExpectedWorkflowContext>;

// If you want to be even more explicit, you can add a const assertion
const _typeTest: TestResult = true;

(async () => {
  try {
    for await (const event of workflow.run()) {
      console.log(`Step: ${event.completedStep?.title || event.type}`);
      console.log('New Context:', event.newContext);
      console.log('-------------------');
    }
  } catch (error) {
    console.error('Workflow error:', error);
  }
})();