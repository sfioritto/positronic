import { z } from "zod";
import type { PromptClient } from "../types";
import type { JsonObject, SerializedError, Context } from "./types";
import { STATUS, WORKFLOW_EVENTS } from './constants';

export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

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

export type StepBlock<TContextIn, TContextOut, TOptions extends object = {}> = {
  type: 'step';
  title: string;
  action: (params: { context: TContextIn; options: TOptions }) => TContextOut | Promise<TContextOut>;
};

type WorkflowBlock<
  TOuterContext,
  TInnerContext extends Context,
  TNewContext,
  TOptions extends object = {}
> = {
  type: 'workflow';
  title: string;
  innerWorkflow: Workflow<TOptions, TInnerContext>;
  initialContext: TInnerContext | ((outerCtx: TOuterContext) => TInnerContext);
  action: (outerCtx: TOuterContext, innerCtx: TInnerContext) => TNewContext;
};

type Block<TContextIn, TContextOut, TOptions extends object = {}> =
  | StepBlock<TContextIn, TContextOut, TOptions>
  | WorkflowBlock<TContextIn, any, TContextOut, TOptions>;

interface RunParams<
  TOptions extends object = {},
  TContextIn extends Context = Context
> {
  initialContext?: TContextIn;
  options?: TOptions;
  initialCompletedSteps?: SerializedStep[];
}

export type WorkflowExtension = (workflow: Workflow<any, any>) => void;

const clone = <T>(value: T): T => structuredClone(value);

export function workflow<
  TOptions extends object = {},
  TContext extends Context = {}
>(
  workflowConfig: string | { title: string; description?: string },
  client: PromptClient
) {
  const title = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.title;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  return new Workflow<TOptions, TContext>(client, title, description);
}

export class Workflow<
  TOptions extends object = {},
  TContext extends Context = {}
> {
  private blocks: Block<any, any, TOptions>[] = [];

  constructor(
    private client: PromptClient,
    private title: string,
    private description?: string
  ) {
  }

  step<TNewContext extends Context>(
    title: string,
    action: (params: { context: TContext; options: TOptions }) => TNewContext | Promise<TNewContext>
  ) {
    const stepBlock: StepBlock<TContext, TNewContext, TOptions> = {
      type: 'step',
      title,
      action
    };
    this.blocks.push(stepBlock);
    return this.nextWorkflow<TNewContext>();
  }

  workflow<
    TInnerContext extends Context,
    TNewContext extends Context
  >(
    title: string,
    innerWorkflow: Workflow<TOptions, TInnerContext>,
    action: (params: { context: TContext, workflowContext: TInnerContext }) => TNewContext,
    initialContext?: TInnerContext | ((context: TContext) => TInnerContext)
  ) {
    const nestedBlock: WorkflowBlock<
      TContext,
      TInnerContext,
      TNewContext,
      TOptions
    > = {
      type: 'workflow',
      title,
      innerWorkflow,
      initialContext: initialContext || (() => ({} as TInnerContext)),
      action: (outerCtx, innerCtx) => action({ context: outerCtx, workflowContext: innerCtx})
    };
    this.blocks.push(nestedBlock);
    return this.nextWorkflow<TNewContext>();
  }

  prompt<
    TResponseKey extends string,
    TSchema extends z.ZodObject<any>
  >(
    title: string,
    config: {
      template: (ctx: TContext) => string;
      responseModel: {
        schema: TSchema;
        name: TResponseKey;
      };
      client?: PromptClient;
    }
  ) {
    const promptBlock: StepBlock<
      TContext,
      TContext & { [K in TResponseKey]: z.infer<TSchema> },
      TOptions
    > = {
      type: 'step',
      title,
      action: async ({ context }) => {
        const { client: workflowClient } = this;
        const { client: stepClient, template, responseModel } = config;
        const client = stepClient ?? workflowClient;
        const promptString = template(context);
        const response = await client.execute(promptString, responseModel);

        return {
          ...context,
          [config.responseModel.name]: response
        };
      }
    };
    this.blocks.push(promptBlock);
    return this.nextWorkflow<TContext & { [K in TResponseKey]: z.infer<TSchema> }>();
  }

  async *run(params?: RunParams<TOptions, TContext>): AsyncGenerator<Event<TContext, TContext, TOptions>> {
    for await (const event of this._run(clone(params))) {
      yield clone(event);
    }
  }

  private withBlocks(blocks: Block<any, any, TOptions>[]): this {
    this.blocks = blocks;
    return this;
  }

  private nextWorkflow<TNewContext extends Context>(): Workflow<TOptions, TNewContext> {
    return new Workflow<TOptions, TNewContext>(
      this.client,
      this.title,
      this.description
    ).withBlocks(this.blocks);
  }

  /**
   * This is separated from the public run() method to centralize all deep cloning
   * operations to ensure that all data that should be cloned to prevent object mutation
   * by consumers of the workflow is in fact cloned. This guarantees that all input and output
   * data is immutable and safe to use by consumers of the workflow.
   */
  private async *_run(params?: RunParams<TOptions, TContext>): AsyncGenerator<Event<TContext, TContext, TOptions>> {
    const { initialContext, options = {} as TOptions, initialCompletedSteps } = params || {};
    let currentContext = clone(initialContext || {}) as TContext;
    const completedSteps: SerializedStep[] = [...(initialCompletedSteps || [])];

    if (completedSteps.length > 0) {
      currentContext = clone(completedSteps[completedSteps.length - 1].context as TContext);
    }

    const remainingBlocks = this.blocks.slice(completedSteps.length);

    yield {
      type: completedSteps.length > 0 ? 'workflow:restart' : 'workflow:start',
      status: STATUS.RUNNING,
      workflowTitle: this.title,
      workflowDescription: this.description,
      previousContext: currentContext,
      newContext: currentContext,
      steps: this.blocks.map(block => ({
        title: block.title,
        status: STATUS.PENDING,
        context: currentContext
      })),
      options,
    };

    for (const block of remainingBlocks) {
      // Clone the current context here to prevent mutation of the context
      // when the block is executed. The initial clone in the first pass
      // of the loop is not necessary, but it is needed for every other pass
      // and putting it here makes it easier to see.
      currentContext = clone(currentContext);
      const previousContext = currentContext;
      try {
        if (block.type === 'step') {
          currentContext = await block.action({
            context: currentContext,
            options,
          });
        } else if (block.type === 'workflow') {
          const childInitial = typeof block.initialContext === 'function'
            ? block.initialContext(currentContext)
            : block.initialContext;

          // Run inner workflow and yield all its events
          const innerRun = block.innerWorkflow.run({
            initialContext: childInitial,
            options,
          });

          let innerCtx;
          for await (const event of innerRun) {
            yield event; // Forward inner workflow events
            if (event.type === 'workflow:complete') {
              innerCtx = event.newContext;
            }
          }

          if (!innerCtx) {
            throw new Error('Inner workflow did not complete');
          }

          currentContext = block.action(currentContext, innerCtx);
        }

        const completedStep = {
          title: block.title,
          status: STATUS.COMPLETE,
          context: currentContext
        };
        completedSteps.push(completedStep);

        yield {
          type: 'workflow:update',
          status: STATUS.RUNNING,
          workflowTitle: this.title,
          workflowDescription: this.description,
          previousContext,
          newContext: currentContext,
          completedStep,
          steps: this.blocks.map((b, i) =>
            completedSteps[i] || {
              title: b.title,
              status: STATUS.PENDING,
              context: currentContext
            }
          ),
          options,
        };
      } catch (error) {
        const errorStep = {
          title: block.title,
          status: STATUS.ERROR,
          context: currentContext
        };
        completedSteps.push(errorStep);

        yield {
          type: 'workflow:error',
          status: STATUS.ERROR,
          workflowTitle: this.title,
          workflowDescription: this.description,
          previousContext,
          newContext: currentContext,
          completedStep: errorStep,
          error: error as SerializedError,
          steps: this.blocks.map((b, i) =>
            completedSteps[i] || {
              title: b.title,
              status: STATUS.PENDING,
              context: currentContext
            }
          ),
          options,
        };
        throw error;
      }
    }

    yield {
      type: 'workflow:complete',
      status: STATUS.COMPLETE,
      workflowTitle: this.title,
      workflowDescription: this.description,
      previousContext: initialContext || {} as TContext,
      newContext: currentContext,
      steps: completedSteps,
      options,
    };

    return currentContext;
  }
}