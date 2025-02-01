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
  ContextIn extends Context, ContextOut extends Context,
  Options extends object = {}
> {
  workflowName: string;
  description?: string;
  type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS];
  status: typeof STATUS[keyof typeof STATUS];
  previousContext: ContextIn;
  newContext: ContextOut;
  error?: SerializedError;
  completedStep?: SerializedStep;
  steps: SerializedStep[];
  options: Options;
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
  ContextIn extends Context,
  Options extends object = {}
> = {
  title: string;
  action: Action<ContextIn, Options>;
};

type MergeExtensions<
  T extends Extension<any>[]
> = T extends [infer First extends Extension<any>, ...infer Rest extends Extension<any>[]]
  ? Rest extends []
    ? First
    : First & MergeExtensions<Rest>
  : never;

type ExtensionReturn<R> = R extends StepBlock<any, any>
  ? R extends { action: infer A }
    ? A extends (...args: any[]) => infer Out
      ? Awaited<Out>
      : never
    : never
  : R extends (...args: any[]) => infer Out
    ? Awaited<Out>
    : never;

type GetExtensionResult<T> = T extends (...args: any[]) => infer R
  ? R extends StepBlock<any, any>
    ? R extends { action: infer A }
      ? A extends (...args: any[]) => infer Out
        ? Awaited<Out>
        : never
      : never
    : R extends (...args: any[]) => infer Out
      ? Awaited<Out>
      : never
  : never;

// Simplified to only handle functions
type GetParameters<T> = T extends (...args: infer P) => any
  ? P
  : never;

type BuilderExtension<
  TContextIn extends Context,
  TOptions extends object,
  TExtension extends Extension<Context>
> = {
  [K in keyof TExtension]: TExtension[K] extends ExtensionMethod<any, any>
    ? (
        ...args: GetParameters<TExtension[K]>
      ) => Builder<
        TContextIn & GetExtensionResult<TExtension[K]>,
        TOptions,
        TExtension
      >
    : {
        [P in keyof TExtension[K]]: TExtension[K][P] extends ExtensionMethod<any, any>
          ? (
              ...args: GetParameters<TExtension[K][P]>
            ) => Builder<
              TContextIn & GetExtensionResult<TExtension[K][P]>,
              TOptions,
              TExtension
            >
          : never
      }
};

interface RunParams<
  Options extends object = {},
  ContextIn extends Context = Context
> {
  initialContext?: ContextIn;
  options?: Options;
  initialCompletedSteps?: SerializedStep[];
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
  title: string;
  description?: string;
} & BuilderExtension<Flatten<TContextIn>, TOptions, TExtension>;

export const createWorkflow = <
  TOptions extends object = {},
  TExtensions extends Extension<Context>[] = [Extension<Context>]
>(
  nameOrConfig: string | WorkflowConfig,
  extensions: TExtensions | [] = []
) => {
  const workflowName = typeof nameOrConfig === 'string' ? nameOrConfig : nameOrConfig.name;
  const description = typeof nameOrConfig === 'string' ? undefined : nameOrConfig.description;
  const extensionBlock = Object.assign({}, ...extensions) as MergeExtensions<TExtensions>;
  const combinedExtension = createExtension(extensionBlock);
  return createBuilder<Context, TOptions, typeof combinedExtension>({
    extension: combinedExtension,
    steps: [],
    title: workflowName,
    description
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

function createBuilder<
  ContextIn extends Context,
  Options extends object,
  TExtension extends Extension<Context>
>(
  props: {
    extension: TExtension;
    steps?: StepBlock<any, Options>[];
    title: string;
    description?: string;
  }
): Builder<ContextIn, Options, TExtension> {
  const { extension, steps = [], title, description } = props;

  const builder = {
    step: (<TContextOut extends Context>(
      stepTitle: string,
      action: (params: { context: Flatten<ContextIn>; options: Options }) => TContextOut | Promise<TContextOut>
    ) => {
      const newStep: StepBlock<any, Options> = { title: stepTitle, action };
      return createBuilder<TContextOut, Options, TExtension>({
        extension,
        steps: [...steps, newStep],
        title,
        description,
      });
    }),
    ...Object.fromEntries(
      Object.entries(extension).map(([key, extProp]) => {
        if (typeof extProp === 'function') {
          return [
            key,
            (...args: any[]) => {
              const newStep = createExtensionStep(key, extProp, args);
              return createBuilder<ContextIn, Options, TExtension>({
                extension,
                steps: [...steps, newStep],
                title,
                description,
              });
            }
          ];
        } else {
          // Nested extension case
          return [
            key,
            Object.fromEntries(
              Object.entries(extProp as object).map(([subKey, subMethod]) => {
                return [
                  subKey,
                  (...args: any[]) => {
                    const newStep = createExtensionStep(`${key}.${subKey}`, subMethod, args);
                    return createBuilder<ContextIn, Options, TExtension>({
                      extension,
                      steps: [...steps, newStep],
                      title,
                      description,
                    });
                  }
                ];
              })
            )
          ];
        }
      })
    ),
    run: async function*({
      initialContext = {} as ContextIn,
      options = {} as Options,
      initialCompletedSteps = []
    }: RunParams<Options, ContextIn> = {}) {
      let currentContext = clone(initialContext) as Context;
      const completedSteps: SerializedStep[] = [...initialCompletedSteps];

      if (initialCompletedSteps.length > 0) {
        currentContext = clone(initialCompletedSteps[initialCompletedSteps.length - 1].context);
      }

      yield clone({
        workflowName: title,
        description,
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
            workflowName: title,
            description,
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
            workflowName: title,
            description,
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
        workflowName: title,
        description,
        type: WORKFLOW_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        previousContext: initialContext,
        newContext: currentContext,
        steps: completedSteps,
        options
      });
    },
    // Expose the config on the builder
    extension,
    steps,
    title,
    description
  } as Builder<ContextIn, Options, TExtension>;

  return builder;
}

export const createExtension = <
  TExtension extends Extension<Context>
>(ext: TExtension): TExtension => ext;

