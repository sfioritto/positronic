export type Context = { [key: string]: any };

export type Block<TContextIn, TContextOut> = (ctx: TContextIn) => TContextOut | Promise<TContextOut>;

type WorkflowBlock<TOuterContext, TInnerContext extends Context, TNewContext> = {
  type: 'workflow';
  title: string;
  innerWorkflow: Workflow<TInnerContext>;
  initialChildContext: TInnerContext | ((outerCtx: TOuterContext) => TInnerContext);
  reducer: (outerCtx: TOuterContext, innerCtx: TInnerContext) => TNewContext;
};

type AnyBlock<TContextIn, TContextOut> =
  | Block<TContextIn, TContextOut>
  | WorkflowBlock<TContextIn, any, TContextOut>;

export class Workflow<TContext extends Context> {
  private blocks: AnyBlock<any, any>[] = [];

  constructor(private initialContext: TContext) {}

  step<TNewContext extends Context>(
    title: string,
    fn: Block<TContext, TNewContext>
  ): Workflow<TNewContext> {
    this.blocks.push(fn);
    return new Workflow<TNewContext>(this.initialContext as any).withBlocks(this.blocks);
  }

  workflow<TInnerContext extends Context, TNewContext extends Context>(
    title: string,
    innerWorkflow: Workflow<TInnerContext>,
    reducer: (params: { context: TContext, workflowContext: TInnerContext }) => TNewContext,
    initialChildContext?: TInnerContext | ((context: TContext) => TInnerContext)
  ): Workflow<TNewContext> {
    const nestedBlock: WorkflowBlock<TContext, TInnerContext, TNewContext> = {
      type: 'workflow',
      title,
      innerWorkflow,
      initialChildContext: initialChildContext || (() => ({} as TInnerContext)),
      reducer: (outerCtx, innerCtx) => reducer({ context: outerCtx, workflowContext: innerCtx })
    };
    this.blocks.push(nestedBlock);
    return new Workflow<TNewContext>(this.initialContext as any).withBlocks(this.blocks);
  }

  prompt<TResponse, TKey extends string>(
    title: string,
    config: {
      responseKey: TKey;
      getResponse: (ctx: TContext) => Promise<TResponse>
    }
  ): Workflow<TContext & { [K in TKey]: TResponse }> {
    const promptBlock: Block<TContext, TContext & { [K in TKey]: TResponse }> = async (ctx) => {
      const response = await config.getResponse(ctx);
      return { ...ctx, [config.responseKey]: response };
    };
    this.blocks.push(promptBlock);
    return new Workflow<TContext & { [K in TKey]: TResponse }>(this.initialContext as any).withBlocks(this.blocks);
  }

  private withBlocks(blocks: AnyBlock<any, any>[]): this {
    this.blocks = blocks;
    return this;
  }

  async run(): Promise<TContext> {
    let ctx = this.initialContext;
    for (const block of this.blocks) {
      if (typeof block === 'function') {
        ctx = await block(ctx);
      } else if (block.type === 'workflow') {
        const childInitial = typeof block.initialChildContext === 'function'
          ? block.initialChildContext(ctx)
          : block.initialChildContext;
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
    multiply: (factor: number) =>
      workflow.step("Multiply", async ctx => {
        return { ...ctx, value: ctx.value * factor };
      })
  };
}

(async () => {
  // Create an inner workflow expecting 'input' instead of already having 'doubled'
  const innerWorkflow = new Workflow<{ input: number }>({ input: 0 })
    .step("Double Value", async (ctx) => ({
      doubled: ctx.input * 2
    }));

  // Create the main workflow
  const mainWorkflow = new Workflow({ value: 5, message: "Hello" });

  // Add the math extension
  const workflowWithExtensions = withExtensions(mainWorkflow, customMathExtension);

  // Build the workflow with nested components
  const finalWorkflow = workflowWithExtensions
    .multiply(3)  // value becomes 15
    .step("Add Message", ctx => ({
      ...ctx,
      message: ctx.message + ", World!"
    }))
    .workflow(
      "Run Inner Workflow",
      innerWorkflow,
      ({ context, workflowContext }) => ({
        ...context,
        doubledValue: workflowContext.doubled
      }),
      (ctx) => ({ doubled: ctx.value })
    )
    .prompt("Get User Input", {
      responseKey: "userInput",
      getResponse: async (ctx) => {
        return `Doubled value was: ${ctx.doubledValue}`;
      }
    });

  const result = await finalWorkflow.run();
  console.log("Final Result:", result);
  // Output will be something like:
  // {
  //   value: 15,
  //   message: "Hello, World!",
  //   doubledValue: 30,
  //   userInput: "Doubled value was: 30"
  // }
})();