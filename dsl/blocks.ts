import { z } from "zod";
import type { PromptClient } from "../types";
import type { JsonObject, SerializedError } from "./types";
import { STATUS, WORKFLOW_EVENTS } from './constants';

export type Context = JsonObject;

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
  execute: (params: { context: TContextIn; options: TOptions }) => TContextOut | Promise<TContextOut>;
};

type WorkflowBlock<TOuterContext, TInnerContext extends Context, TNewContext, TOptions extends object = {}> = {
  type: 'workflow';
  title: string;
  innerWorkflow: Workflow<TOptions, TInnerContext>;
  initialContext: TInnerContext | ((outerCtx: TOuterContext) => TInnerContext);
  reducer: (outerCtx: TOuterContext, innerCtx: TInnerContext) => TNewContext;
};

type Block<TContextIn, TContextOut, TOptions extends object = {}> =
  | StepBlock<TContextIn, TContextOut, TOptions>
  | WorkflowBlock<TContextIn, any, TContextOut, TOptions>;

interface RunParams<
  TOptions extends object = {},
  TContextIn extends Context = Context
> {
  initialContext?: TContextIn;
  options: TOptions;
  initialCompletedSteps?: SerializedStep[];
}

export type WorkflowExtension = (workflow: Workflow<any, any>) => void;

export function workflow<TOptions extends object = {}, TContext extends Context = {}>(
  workflowConfig: string | { title: string; description?: string },
  client: PromptClient
) {
  const title = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.title;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  return new Workflow<TOptions, TContext>(client, title, description);
}

export class Workflow<TOptions extends object = {}, TContext extends Context = {}> {
  private blocks: Block<any, any, TOptions>[] = [];
  private client: PromptClient;
  private title: string;
  private description?: string;

  constructor(client: PromptClient, title: string, description?: string) {
    this.client = client;
    this.title = title;
    this.description = description;
  }

  step<TNewContext extends Context>(
    title: string,
    fn: (params: { context: TContext; options: TOptions }) => TNewContext | Promise<TNewContext>
  ) {
    const stepBlock: StepBlock<TContext, TNewContext, TOptions> = {
      type: 'step',
      title,
      execute: fn
    };
    this.blocks.push(stepBlock);
    return new Workflow<TOptions, TNewContext>(this.client, this.title, this.description).withBlocks(this.blocks);
  }

  workflow<TInnerContext extends Context, TNewContext extends Context>(
    title: string,
    innerWorkflow: Workflow<TOptions, TInnerContext>,
    reducer: (params: { context: TContext, workflowContext: TInnerContext }) => TNewContext,
    initialContext?: TInnerContext | ((context: TContext) => TInnerContext)
  ) {
    const nestedBlock: WorkflowBlock<TContext, TInnerContext, TNewContext, TOptions> = {
      type: 'workflow',
      title,
      innerWorkflow,
      initialContext: initialContext || (() => ({} as TInnerContext)),
      reducer: (outerCtx, innerCtx) => reducer({ context: outerCtx, workflowContext: innerCtx})
    };
    this.blocks.push(nestedBlock);
    return new Workflow<TOptions, TNewContext>(this.client, this.title, this.description).withBlocks(this.blocks);
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
  ): Workflow<TOptions, TContext & { [K in TResponseKey]: z.infer<TSchema> }> {
    const promptBlock: StepBlock<
      TContext,
      TContext & { [K in TResponseKey]: z.infer<TSchema> },
      TOptions
    > = {
      type: 'step',
      title,
      execute: async ({ context, options }) => {
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
    return new Workflow<
      TOptions,
      TContext & { [K in TResponseKey]: z.infer<TSchema> }
    >(this.client, this.title, this.description).withBlocks(this.blocks);
  }

  private withBlocks(blocks: Block<any, any, TOptions>[]): this {
    this.blocks = blocks;
    return this;
  }

  async *run(params: RunParams<TOptions, TContext>): AsyncGenerator<Event<TContext, TContext, TOptions>> {
    // Clone all input params
    const clonedParams: RunParams<TOptions, TContext> = {
      initialContext: params.initialContext ? structuredClone(params.initialContext) : {} as TContext,
      options: structuredClone(params.options),
      initialCompletedSteps: params.initialCompletedSteps ? structuredClone(params.initialCompletedSteps) : []
    };

    // Delegate to private run and clone all yielded events
    for await (const event of this._run(clonedParams)) {
      yield structuredClone(event);
    }
  }

  /**
   * This is separated from the public run() method to centralize all deep cloning
   * operations to ensure that all data that should be cloned to prevent object mutation
   * by consumers of the workflow is in fact cloned. This guarantees that all input and output
   * data is immutable and safe to use by consumers of the workflow.
   */
  private async *_run(params: RunParams<TOptions, TContext>): AsyncGenerator<Event<TContext, TContext, TOptions>> {
    let currentContext = params.initialContext as TContext;
    const completedSteps: SerializedStep[] = [...(params.initialCompletedSteps || [])];

    if (completedSteps.length > 0) {
      currentContext = completedSteps[completedSteps.length - 1].context as TContext;
    }

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
      options: params.options
    };

    // Process each block
    for (const block of this.blocks) {
      const previousContext = structuredClone(currentContext);
      try {
        if (block.type === 'step') {
          currentContext = await block.execute({
            context: structuredClone(currentContext),
            options: params.options
          });
        } else if (block.type === 'workflow') {
          const childInitial = typeof block.initialContext === 'function'
            ? block.initialContext(structuredClone(currentContext))
            : block.initialContext;
          const innerCtx = await block.innerWorkflow.run({
            initialContext: childInitial,
            options: params.options
          });
          currentContext = block.reducer(structuredClone(currentContext), innerCtx);
        }

        const completedStep = {
          title: block.title,
          status: STATUS.COMPLETE,
          context: structuredClone(currentContext)
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
          options: params.options
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
          options: params.options
        };
        throw error;
      }
    }

    yield {
      type: 'workflow:complete',
      status: STATUS.COMPLETE,
      workflowTitle: this.title,
      workflowDescription: this.description,
      previousContext: params.initialContext || {} as TContext,
      newContext: currentContext,
      steps: completedSteps,
      options: params.options
    };

    return currentContext;
  }
}