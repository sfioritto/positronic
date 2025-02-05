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

export class Workflow<TContext extends Context> {
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

export type ExtendedWorkflow<TContext extends Context, TE> = Workflow<TContext> & TE;

export function withExtensions<TContext extends Context, TE>(
  workflow: Workflow<TContext>,
  extensionCreators: (wf: Workflow<TContext>) => TE
): ExtendedWorkflow<TContext, TE> {
  const extensions = extensionCreators(workflow);
  return Object.assign(workflow, extensions);
}

// Example Usage with Nested Workflows:

function customMathExtension<TContext extends { value: number }>(workflow: Workflow<TContext>) {
  return {
    nested: {
      multiply: (factor: number) =>
        workflow.step("Multiply", async ctx => {
          return { ...ctx, value: ctx.value * factor };
        }),
    }
  };
}

// Example workflow with all features for type testing
const testWorkflow = new Workflow<{ initial: string }>(new AnthropicClient())
  .step("Initialize value", ctx => ({
    ...ctx,
    value: 0
  }))
  .step("Add numbers", async ctx => ({
    ...ctx,
    sum: 42
  }))
  .prompt("Get user input", {
    template: (ctx) => "Your prompt here",
    responseModel: {
      schema: z.object({ cool: z.string(), id: z.number() }),
      name: "userResponse"
    }
  })
  .step("Add user response", ctx => ctx)
  .workflow(
    "Nested workflow",
    new Workflow(new AnthropicClient())
      .step("Nested step", ctx => ({
        ...ctx,
        nestedValue: "computed",
      })),
    ({ context, workflowContext }) => ({
      ...context,
      fromNested: workflowContext.nestedValue
    })
  )
  .step("Final Step", ctx => ctx);

// Add math extension
const workflowWithMath = withExtensions(
  testWorkflow,
  customMathExtension
).nested.multiply(2);

// Type testing utilities
type AssertEquals<T, U> =
  0 extends (1 & T) ? false : // fails if T is any
  0 extends (1 & U) ? false : // fails if U is any
  [T] extends [U] ? [U] extends [T] ? true : false : false;

// Expected final context type
type ExpectedFinalContext = {
  initial: string;
  sum: number;
  userResponse: { cool: string, id: number };
  fromNested: string;
  value: number;
};

// Extract the context type from the workflow
type ExtractContextType<T> = T extends Workflow<infer Context> ? Context : never;

// Get the actual final context type
type ActualFinalContext = ExtractContextType<typeof workflowWithMath>;

// This will show a type error if the types don't match
type TypeTest = AssertEquals<ActualFinalContext, ExpectedFinalContext>;

// Explicit type assertion
const _typeTest: TypeTest = true;

// Run the workflow to verify runtime behavior
(async () => {
  const result = await workflowWithMath.run();
  console.log("Type test result:", result);
})();