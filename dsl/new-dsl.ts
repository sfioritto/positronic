import { JsonObject, SerializedError } from "./types";
import { WORKFLOW_EVENTS, STATUS } from './constants';

// Creates a deep clone of an object to prevent mutation of internal state.
// This is used throughout the workflow engine to ensure immutability and prevent
// side effects from consumer code modifying shared state.
function clone<T>(original: T): T {
  return structuredClone(original) as T;
}

type Context = JsonObject;

interface WorkflowConfig {
  title: string;
  description?: string;
}

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

type MaybePromise<T> = T | Promise<T>;

type Action<
  TContextIn extends Context,
  TOptions extends object = {},
  TContextOut extends Context = TContextIn & Context
> = (params: { context: TContextIn; options: TOptions }) => MaybePromise<TContextOut>;

type Flatten<T> = T extends object
  ? T extends Promise<infer R>
    ? Flatten<R>
    : { [K in keyof T]: T[K] }
  : T;

export type ExtensionMethod<TContextIn extends Context, TOptions extends object = {}> =
  (...args: any[]) => StepBlock<TContextIn, TOptions> | Action<TContextIn, TOptions>;

type Extension<
  TContextIn extends Context,
  TOptions extends object = {}
> = {
  [name: string]: ExtensionMethod<TContextIn, TOptions> | {
    [name: string]: ExtensionMethod<TContextIn, TOptions>
  }
};

type StepBlock<
  TContextIn extends Context,
  TOptions extends object = {}
> = {
  title: string;
  action: Action<TContextIn, TOptions>;
};

// New types for workflow steps
type WorkflowBlockReducer<
  TContextIn extends Context,
  TWorkflowContext extends Context,
> = (params: {
  context: TContextIn;
  workflowContext: TWorkflowContext
}) => TContextIn;

type WorkflowBlock<
  TContextIn extends Context,
  TOptions extends object = {},
  TWorkflowContext extends Context = Context,
  TWorkflowInitialContext extends Context = Context
> = {
  title: string;
  workflow: Workflow<TWorkflowInitialContext, any, TOptions>;
  initialContext: TWorkflowInitialContext | ((context: TContextIn) => TWorkflowInitialContext);
  reducer: WorkflowBlockReducer<TContextIn, TWorkflowContext>;
  _type: 'workflow_step';
};

// Union type for all possible blocks
type Block<
  TContextIn extends Context,
  TOptions extends object = {},
> = StepBlock<TContextIn, TOptions> | WorkflowBlock<TContextIn, TOptions, any>;

// Type guard to distinguish between step types
function isWorkflowStep<
  TContextIn extends Context,
  TOptions extends object,
>(step: Block<TContextIn, TOptions>): step is WorkflowBlock<TContextIn, TOptions, any> {
  return '_type' in step && step._type === 'workflow_step';
}

type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

type MergeExtensions<TExtension extends Extension<Context>[]> = UnionToIntersection<TExtension[number]> & Extension<Context>;

// Extracts the context type from a StepBlock's action or a direct function
type ExtensionReturn<R> = R extends StepBlock<any, any>
  ? R extends { action: infer A }
    ? A extends (...args: any[]) => infer Out
      ? Awaited<Out>
      : never
    : never
  : R extends (...args: any[]) => infer Out
    ? Awaited<Out>
    : never;

// Extracts the context type from an extension method or step block
type ExtractContextType<T> = T extends (...args: any[]) => infer R
  ? ExtensionReturn<R>
  : never;

type ExtensionMethodBuilder<
  TContextIn extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>,
  TMethod extends ExtensionMethod<any, any> | Record<string, ExtensionMethod<any, any>>
> = TMethod extends ExtensionMethod<any, any>
  ? (...args: Parameters<TMethod>) => Workflow<TContextIn & ExtractContextType<TMethod>, TExtension, TOptions>
  : TMethod extends Record<string, ExtensionMethod<any, any>>
    ? { [P in keyof TMethod]: ExtensionMethodBuilder<TContextIn, TOptions, TExtension, TMethod[P]> }
    : never;

type ExtendedBuilder<
  TContextIn extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>
> = {
  [K in keyof TExtension]: ExtensionMethodBuilder<TContextIn, TOptions, TExtension, TExtension[K]>
};

interface RunParams<
  TOptions extends object = {},
  TContextIn extends Context = Context
> {
  initialContext?: TContextIn;
  options?: TOptions;
  initialCompletedSteps?: SerializedStep[];
}

interface BuilderProps<
  TContextIn extends Context,
  TExtension extends Extension<Context>,
  TOptions extends object
> {
  extension: TExtension;
  steps: Block<TContextIn, TOptions>[];
  workflowTitle: string;
  workflowDescription?: string;
}

export type Workflow<
  TContextIn extends Context,
  TExtension extends Extension<Context>,
  TOptions extends object = {}
> = {
  step: <TContextOut extends Context>(
    title: string,
    action: (params: { context: Flatten<TContextIn>; options: TOptions }) => MaybePromise<TContextOut>
  ) => Workflow<TContextOut, TExtension, TOptions>;

  workflow: <TWorkflowContext extends Context>(
    title: string,
    workflow: Workflow<any, any, TOptions> & { run: () => AsyncGenerator<Event<any, TWorkflowContext, TOptions>> },
    reducer: WorkflowBlockReducer<TContextIn, TWorkflowContext>
  ) => Workflow<TContextIn, TExtension, TOptions>;

  run(params?: RunParams<TOptions, TContextIn>): AsyncGenerator<Event<TContextIn, TContextIn, TOptions>, void, unknown>;

  extension: TExtension;
  steps: Block<any, TOptions>[];
  workflowTitle: string;
  workflowDescription?: string;
} & ExtendedBuilder<Flatten<TContextIn>, TOptions, TExtension>;

function createExtensionStep<
  ContextIn extends Context,
  Options extends object
>(
  key: string,
  extensionMethod: ExtensionMethod<ContextIn, Options>,
  args: any[]
): StepBlock<ContextIn, Options> {
  const stepResult = extensionMethod(...args);

  // If stepResult is a StepBlock, return it directly
  if (
    stepResult &&
    typeof stepResult === 'object' &&
    'action' in stepResult &&
    typeof (stepResult as any).title === 'string'
  ) {
    return stepResult as StepBlock<ContextIn, Options>;
  }

  // Otherwise wrap the action in a StepBlock with the default title
  return {
    title: key,
    action: stepResult as Action<ContextIn, Options>
  };
}

// This function is recursive, however, ExtensionMethod still allows
// only one level of nesting. I made this recursive because it's a lot
// easier to read and should make it easier to allow more nesting in the future.
function bindExtension<
  TContext extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>
>(
  builderProps: BuilderProps<TContext, TExtension, TOptions>
) {
  const createMethodHandler = (
    methodName: string,
    methodDefinition: ExtensionMethod<any, any> | Record<string, ExtensionMethod<any, any>>
  ): any => {
    if (typeof methodDefinition === 'function') {
      return (...args: any[]) => {
        const newStep = createExtensionStep(methodName, methodDefinition as ExtensionMethod<any, any>, args);
        return createWorkflowBuilder({
          ...builderProps,
          steps: [...builderProps.steps, newStep],
        });
      };
    }
    return Object.fromEntries(
      Object.entries(methodDefinition).map(([nestedName, nestedMethod]) => [
        nestedName,
        createMethodHandler(`${methodName}.${nestedName}`, nestedMethod)
      ])
    );
  };

  return Object.fromEntries(
    Object.entries(builderProps.extension).map(([methodName, methodDefinition]) => [
      methodName,
      createMethodHandler(methodName, methodDefinition)
    ])
  );
}

class WorkflowEventStream<TContextIn extends Context, TOptions extends object> {
  public hasError = false;
  private currentContext: TContextIn;
  private completedSteps: SerializedStep[] = [];
  private readonly initialContext: TContextIn;

  constructor(
    private readonly steps: Block<any, TOptions>[],
    private readonly params: RunParams<TOptions, TContextIn>,
    private readonly workflowTitle: string,
    private readonly workflowDescription?: string,
  ) {
    this.initialContext = clone(params.initialContext || {} as TContextIn);
    this.currentContext = clone(this.initialContext);
    this.completedSteps = [...(params.initialCompletedSteps || [])];

    if (this.completedSteps.length > 0) {
      this.currentContext = clone(this.completedSteps[this.completedSteps.length - 1].context) as TContextIn;
    }
  }

  async* initialize(): AsyncGenerator<Event<any, any, TOptions>> {
    yield this.createEvent({
      type: this.completedSteps.length > 0 ? WORKFLOW_EVENTS.RESTART : WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      steps: this.mapPendingSteps()
    });
  }

  async* processSteps(): AsyncGenerator<Event<any, any, TOptions>> {
    const remainingSteps = this.steps.slice(this.completedSteps.length);

    for (const step of remainingSteps) {
      const previousContext = clone(this.currentContext);
      try {
        yield* this.executeStep(step, previousContext);
      } catch (error) {
        yield* this.handleStepError(step, error, previousContext);
        return;
      }
    }
  }

  private async* executeStep(
    step: Block<any, TOptions>,
    previousContext: Context
  ): AsyncGenerator<Event<any, any, TOptions>> {
    if (isWorkflowStep(step)) {
      yield* this.executeWorkflowStep(step, previousContext);
    } else {
      const result = await step.action({
        context: clone(this.currentContext),
        options: this.params.options || {} as TOptions
      });
      this.currentContext = clone(result);

      const completedStep = {
        title: step.title,
        status: STATUS.COMPLETE,
        context: this.currentContext
      };
      this.completedSteps.push(completedStep);

      yield this.createEvent({
        type: WORKFLOW_EVENTS.UPDATE,
        status: STATUS.RUNNING,
        previousContext,
        completedStep,
        steps: this.mapPendingSteps()
      });
    }
  }

  private async* executeWorkflowStep<TWorkflowContext extends Context>(
    step: WorkflowBlock<TContextIn, TOptions, TWorkflowContext>,
    previousContext: Context
  ): AsyncGenerator<Event<any, any, TOptions>> {
    let lastEvent: Event<any, TWorkflowContext, TOptions>;
    const workflow = step.workflow as Workflow<any, any, TOptions>;
    for await (const event of workflow.run({
      initialContext: clone(this.currentContext),
      options: this.params.options
    })) {
      lastEvent = event as Event<any, TWorkflowContext, TOptions>;
      yield event;
    }

    this.currentContext = clone(
      step.reducer({
        context: this.currentContext,
        workflowContext: lastEvent!.newContext
      })
    );

    const completedStep = {
      title: step.title,
      status: STATUS.COMPLETE,
      context: this.currentContext
    };
    this.completedSteps.push(completedStep);

    yield this.createEvent({
      type: WORKFLOW_EVENTS.UPDATE,
      status: STATUS.RUNNING,
      previousContext,
      completedStep,
      steps: this.mapPendingSteps()
    });
  }

  private async* handleStepError(
    step: Block<any, TOptions>,
    error: unknown,
    previousContext: Context
  ): AsyncGenerator<Event<any, any, TOptions>> {
    console.error((error as Error).message);
    const errorStep = {
      title: step.title,
      status: STATUS.ERROR,
      context: this.currentContext
    };
    this.completedSteps.push(errorStep);

    yield this.createEvent({
      type: WORKFLOW_EVENTS.ERROR,
      status: STATUS.ERROR,
      previousContext,
      completedStep: errorStep,
      error: error as SerializedError,
      steps: this.mapPendingSteps()
    });

    this.hasError = true;
  }

  async* complete(): AsyncGenerator<Event<any, any, TOptions>> {
    yield this.createEvent({
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      previousContext: this.initialContext,
      steps: this.completedSteps
    });
  }

  private createEvent(params: {
    type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS];
    status: typeof STATUS[keyof typeof STATUS];
    steps: SerializedStep[];
    previousContext?: Context;
    completedStep?: SerializedStep;
    error?: SerializedError;
  }): Event<any, any, TOptions> {
    return clone({
      workflowTitle: this.workflowTitle,
      workflowDescription: this.workflowDescription,
      previousContext: params.previousContext || this.initialContext,
      newContext: this.currentContext,
      options: this.params.options || {} as TOptions,
      ...params
    });
  }

  private mapPendingSteps(): SerializedStep[] {
    return this.steps.map((s, index) =>
      this.completedSteps[index] || {
        title: s.title,
        status: STATUS.PENDING,
        context: this.currentContext
      }
    );
  }
}

function createWorkflowBuilder<
  TContextIn extends Context,
  TExtension extends Extension<Context>,
  TOptions extends object = {}
>(props: BuilderProps<TContextIn, TExtension, TOptions>): Workflow<TContextIn, TExtension, TOptions> {
  const { steps, workflowTitle, workflowDescription } = props;

  const builder = {
    step: (<TContextOut extends Context>(
      stepTitle: string,
      action: (params: { context: Flatten<TContextIn>; options: TOptions }) => MaybePromise<TContextOut>
    ) => {
      const newStep: StepBlock<any, TOptions> = { title: stepTitle, action };
      return createWorkflowBuilder({
        ...props,
        steps: [...steps, newStep],
      });
    }),
    workflow: <TWorkflowContext extends Context>(
      title: string,
      workflowToRun: Workflow<any, any, TOptions> & { run: () => AsyncGenerator<Event<any, TWorkflowContext, TOptions>> },
      reducer: WorkflowBlockReducer<TContextIn, TWorkflowContext>
    ) => {
      const newStep = {
        title,
        workflow: workflowToRun,
        reducer,
        _type: 'workflow_step'
      } as WorkflowBlock<TContextIn, TOptions, any, any>;
      return createWorkflowBuilder({
        ...props,
        steps: [...steps, newStep],
      });
    },
    run: async function* (params: RunParams<TOptions, TContextIn> = {}) {
      const eventStream = new WorkflowEventStream(
        steps,
        params,
        workflowTitle,
        workflowDescription
      );

      yield* eventStream.initialize();
      yield* eventStream.processSteps();
      // Only complete if no error occurred
      if (!eventStream.hasError) {
        yield* eventStream.complete();
      }
    },
    ...bindExtension(props),
    ...props
  } as Workflow<TContextIn, TExtension, TOptions>;

  return builder;
}

export const createExtension = <
  TExtension extends Extension<Context>
  >(ext: TExtension): TExtension => ext;

export const createWorkflow = <
  TOptions extends object = {},
  TExtensions extends Extension<Context>[] = [Extension<Context>]
>(
  workflowConfig: string | WorkflowConfig,
  extensions: TExtensions | [] = []
) => {
  const workflowName = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.title;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  const mergedExtensions = Object.assign({}, ...extensions) as MergeExtensions<TExtensions>;
  const extension = createExtension(mergedExtensions);
  return createWorkflowBuilder<Context, typeof extension, TOptions>({
    extension,
    steps: [],
    workflowTitle: workflowName,
    workflowDescription: description
  });
}


