import { JsonObject, SerializedError } from "./types";
import { WORKFLOW_EVENTS, STATUS } from './constants';

function clone<T>(original: T): T {
  return structuredClone(original) as T;
}

type Context = JsonObject;

interface WorkflowConfig {
  name: string;
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

type Action<
  TContextIn extends Context,
  TOptions extends object = {},
  TContextOut extends Context = TContextIn & Context
> = (params: { context: TContextIn; options: TOptions }) => TContextOut | Promise<TContextOut>;

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

type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

type MergeExtensions<TExtension extends Extension<Context>[]> = UnionToIntersection<TExtension[number]> & Extension<Context>;

/**
 * Extracts the context type from a StepBlock's action or a direct function
 */
type ExtensionReturn<R> = R extends StepBlock<any, any>
  ? R extends { action: infer A }
    ? A extends (...args: any[]) => infer Out
      ? Awaited<Out>
      : never
    : never
  : R extends (...args: any[]) => infer Out
    ? Awaited<Out>
    : never;

/**
 * Extracts the context type from an extension method or step block
 */
type ExtractContextType<T> = T extends (...args: any[]) => infer R
  ? ExtensionReturn<R>
  : never;

type ExtensionMethodBuilder<
  TContextIn extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>,
  TMethod extends ExtensionMethod<any, any> | Record<string, ExtensionMethod<any, any>>
> = TMethod extends ExtensionMethod<any, any>
  ? (...args: Parameters<TMethod>) => Builder<TContextIn & ExtractContextType<TMethod>, TOptions, TExtension>
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
  TContext extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>
> {
  extension: TExtension;
  steps: StepBlock<any, TOptions>[];
  workflowTitle: string;
  workflowDescription?: string;
}

export type Builder<
  TContextIn extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>
> = {
  step: <TContextOut extends Context>(
    title: string,
    action: (params: { context: Flatten<TContextIn>; options: TOptions }) => TContextOut | Promise<TContextOut>
  ) => Builder<
    Flatten<TContextOut>,
    TOptions,
    TExtension
  >;
  run(params?: RunParams<TOptions, TContextIn>): AsyncGenerator<Event<any, any, TOptions>, void, unknown>;
  extension: TExtension;
  steps: StepBlock<any, TOptions>[];
  workflowTitle: string;
  workflowDescription?: string;
} & ExtendedBuilder<Flatten<TContextIn>, TOptions, TExtension>;

export const createWorkflow = <
  TOptions extends object = {},
  TExtensions extends Extension<Context>[] = [Extension<Context>]
>(
  workflowConfig: string | WorkflowConfig,
  extensions: TExtensions | [] = []
) => {
  const workflowName = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.name;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  const mergedExtensions = Object.assign({}, ...extensions) as MergeExtensions<TExtensions>;
  const extension = createExtension(mergedExtensions);
  return createBuilder<Context, TOptions, typeof extension>({
    extension,
    steps: [],
    workflowTitle: workflowName,
    workflowDescription: description
  });
}

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
  builderProps: BuilderProps<TContext, TOptions, TExtension>
) {
  const createMethodHandler = (
    methodName: string,
    methodDefinition: ExtensionMethod<any, any> | Record<string, ExtensionMethod<any, any>>
  ): any => {
    if (typeof methodDefinition === 'function') {
      return (...args: any[]) => {
        const newStep = createExtensionStep(methodName, methodDefinition as ExtensionMethod<any, any>, args);
        return createBuilder({
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

function run<TContext extends Context, TOptions extends object>(
  steps: StepBlock<any, TOptions>[],
  workflowTitle: string,
  workflowDescription?: string
) {
  return async function* run({
    initialContext = {} as TContext,
    options = {} as TOptions,
    initialCompletedSteps = []
  }: RunParams<TOptions, TContext> = {}) {
    let currentContext = clone(initialContext) as Context;
    const completedSteps: SerializedStep[] = [...initialCompletedSteps];

    if (initialCompletedSteps.length > 0) {
      currentContext = clone(initialCompletedSteps[initialCompletedSteps.length - 1].context);
    }

    yield clone({
      workflowTitle,
      workflowDescription,
      type: initialCompletedSteps.length > 0 ? WORKFLOW_EVENTS.RESTART : WORKFLOW_EVENTS.START,
      status: STATUS.RUNNING,
      previousContext: initialContext,
      newContext: currentContext,
      steps: steps.map((step, index) =>
        completedSteps[index] || {
          title: step.title,
          status: STATUS.PENDING,
          context: currentContext
        }
      ),
      options
    });

    const remainingSteps = steps.slice(initialCompletedSteps.length);
    for (const step of remainingSteps) {
      const previousContext = clone(currentContext);

      try {
        const result = await step.action({ context: clone(currentContext), options });
        currentContext = clone(result);

        const completedStep = {
          title: step.title,
          status: STATUS.COMPLETE,
          context: currentContext
        };
        completedSteps.push(completedStep);

        yield clone({
          workflowTitle,
          workflowDescription,
          type: WORKFLOW_EVENTS.UPDATE,
          status: STATUS.RUNNING,
          previousContext,
          newContext: currentContext,
          completedStep,
          steps: steps.map((s, index) =>
            completedSteps[index] || {
              title: s.title,
              status: STATUS.PENDING,
              context: currentContext
            }
          ),
          options
        });

      } catch (error) {
        console.error((error as Error).message);

        const errorStep = {
          title: step.title,
          status: STATUS.ERROR,
          context: currentContext
        };
        completedSteps.push(errorStep);

        yield clone({
          workflowTitle,
          workflowDescription,
          type: WORKFLOW_EVENTS.ERROR,
          status: STATUS.ERROR,
          previousContext,
          newContext: currentContext,
          error: error as SerializedError,
          completedStep: errorStep,
          steps: steps.map((s, index) =>
            completedSteps[index] || {
              title: s.title,
              status: STATUS.PENDING,
              context: currentContext
            }
          ),
          options
        });
        return;
      }
    }

    yield clone({
      workflowTitle,
      workflowDescription,
      type: WORKFLOW_EVENTS.COMPLETE,
      status: STATUS.COMPLETE,
      previousContext: initialContext,
      newContext: currentContext,
      steps: completedSteps,
      options
    });
  };
}

function createBuilder<
  TContext extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>
>(props: BuilderProps<TContext, TOptions, TExtension>): Builder<TContext, TOptions, TExtension> {
  const { steps, workflowTitle, workflowDescription } = props;

  const builder = {
    step: (<TContextOut extends Context>(
      stepTitle: string,
      action: (params: { context: Flatten<TContext>; options: TOptions }) => TContextOut | Promise<TContextOut>
    ) => {
      const newStep: StepBlock<any, TOptions> = { title: stepTitle, action };
      return createBuilder({
        ...props,
        steps: [...steps, newStep],
      });
    }),
    run: run<TContext, TOptions>(steps, workflowTitle, workflowDescription),
    ...bindExtension(props),
    ...props
  } as Builder<TContext, TOptions, TExtension>;

  return builder;
}

export const createExtension = <
  TExtension extends Extension<Context>
>(ext: TExtension): TExtension => ext;

