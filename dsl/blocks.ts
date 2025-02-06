import { Context } from "./new-dsl";
import { z } from "zod";
import { AnthropicClient } from "../clients/anthropic";
import type { PromptClient } from "../types";

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

  async run(initialContext: TContext = {} as TContext): Promise<TContext> {
    let ctx = initialContext;
    for (const block of this.blocks) {
      if (block.type === 'step') {
        ctx = await block.execute(ctx);
      } else if (block.type === 'workflow') {
        const childInitial = typeof block.initialContext === 'function'
          ? block.initialContext(ctx)
          : block.initialContext;
        const innerCtx = await block.innerWorkflow.run();
        ctx = block.reducer(ctx, innerCtx);
      }
    }
    return ctx;
  }
}

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
  .step('Get User Data', async (ctx) => {
    console.log(ctx.notAProperty);
    const response = await fetch('https://api.example.com/users/1');
    const data = await response.json();
    return {
      ...ctx,
      regularStepUserData: data
    };
  })
  .step('Use Data', (ctx) => {
    console.log(ctx.regularStepUserData);
    return ctx;
  });