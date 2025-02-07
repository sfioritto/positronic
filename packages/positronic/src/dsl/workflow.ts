import { z } from "zod";
import type { PromptClient } from "../../../../types";
import type { State } from "./types";
import { STATUS, WORKFLOW_EVENTS } from './constants';

type SerializedError = {
  name: string;
  message: string;
  stack?: string;
}

export interface Event<
  TStateIn extends State,
  TStateOut extends State,
  TOptions extends object = {}
> {
  workflowTitle: string;
  workflowDescription?: string;
  type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS];
  status: typeof STATUS[keyof typeof STATUS];
  previousState: TStateIn;
  newState: TStateOut;
  error?: SerializedError;
  completedStep?: SerializedStep;
  steps: SerializedStep[];
  options: TOptions;
}

interface SerializedStep {
  title: string;
  status: typeof STATUS[keyof typeof STATUS];
  state: State;
}

type StepBlock<TStateIn, TStateOut, TOptions extends object = {}> = {
  type: 'step';
  title: string;
  action: (params: { state: TStateIn; options: TOptions }) => TStateOut | Promise<TStateOut>;
};

type WorkflowBlock<
  TOuterState,
  TInnerState extends State,
  TNewState,
  TOptions extends object = {}
> = {
  type: 'workflow';
  title: string;
  innerWorkflow: Workflow<TOptions, TInnerState>;
  initialState: TInnerState | ((outerCtx: TOuterState) => TInnerState);
  action: (outerCtx: TOuterState, innerCtx: TInnerState) => TNewState;
};

type Block<TStateIn, TStateOut, TOptions extends object = {}> =
  | StepBlock<TStateIn, TStateOut, TOptions>
  | WorkflowBlock<TStateIn, any, TStateOut, TOptions>;

interface RunParams<
  TOptions extends object = {},
  TStateIn extends State = State
> {
  initialState?: TStateIn;
  options?: TOptions;
  initialCompletedSteps?: SerializedStep[];
}

const clone = <T>(value: T): T => structuredClone(value);

export function workflow<
  TOptions extends object = {},
  TState extends State = {}
>(
  workflowConfig: string | { title: string; description?: string },
  client: PromptClient
) {
  const title = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.title;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  return new Workflow<TOptions, TState>(client, title, description);
}

export class Workflow<
  TOptions extends object = {},
  TState extends State = {}
> {
  private blocks: Block<any, any, TOptions>[] = [];

  constructor(
    private client: PromptClient,
    private title: string,
    private description?: string
  ) {
  }

  step<TNewState extends State>(
    title: string,
    action: (params: { state: TState; options: TOptions }) => TNewState | Promise<TNewState>
  ) {
    const stepBlock: StepBlock<TState, TNewState, TOptions> = {
      type: 'step',
      title,
      action
    };
    this.blocks.push(stepBlock);
    return this.nextWorkflow<TNewState>();
  }

  workflow<
    TInnerState extends State,
    TNewState extends State
  >(
    title: string,
    innerWorkflow: Workflow<TOptions, TInnerState>,
    action: (params: { state: TState, workflowState: TInnerState }) => TNewState,
    initialState?: TInnerState | ((state: TState) => TInnerState)
  ) {
    const nestedBlock: WorkflowBlock<
      TState,
      TInnerState,
      TNewState,
      TOptions
    > = {
      type: 'workflow',
      title,
      innerWorkflow,
      initialState: initialState || (() => ({} as TInnerState)),
      action: (outerCtx, innerCtx) => action({ state: outerCtx, workflowState: innerCtx})
    };
    this.blocks.push(nestedBlock);
    return this.nextWorkflow<TNewState>();
  }

  prompt<
    TResponseKey extends string,
    TSchema extends z.ZodObject<any>
  >(
    title: string,
    config: {
      template: (ctx: TState) => string;
      responseModel: {
        schema: TSchema;
        name: TResponseKey;
      };
      client?: PromptClient;
    }
  ) {
    const promptBlock: StepBlock<
      TState,
      TState & { [K in TResponseKey]: z.infer<TSchema> },
      TOptions
    > = {
      type: 'step',
      title,
      action: async ({ state }) => {
        const { client: workflowClient } = this;
        const { client: stepClient, template, responseModel } = config;
        const client = stepClient ?? workflowClient;
        const promptString = template(state);
        const response = await client.execute(promptString, responseModel);

        return {
          ...state,
          [config.responseModel.name]: response
        };
      }
    };
    this.blocks.push(promptBlock);
    return this.nextWorkflow<TState & { [K in TResponseKey]: z.infer<TSchema> }>();
  }

  async *run(params?: RunParams<TOptions, TState>): AsyncGenerator<Event<TState, TState, TOptions>> {
    for await (const event of this._run(clone(params))) {
      yield clone(event);
    }
  }

  private withBlocks(blocks: Block<any, any, TOptions>[]): this {
    this.blocks = blocks;
    return this;
  }

  private nextWorkflow<TNewState extends State>(): Workflow<TOptions, TNewState> {
    return new Workflow<TOptions, TNewState>(
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
  private async *_run(params?: RunParams<TOptions, TState>): AsyncGenerator<Event<TState, TState, TOptions>> {
    const { initialState, options = {} as TOptions, initialCompletedSteps } = params || {};
    let currentState = clone(initialState || {}) as TState;
    const completedSteps: SerializedStep[] = [...(initialCompletedSteps || [])];

    if (completedSteps.length > 0) {
      currentState = clone(completedSteps[completedSteps.length - 1].state as TState);
    }

    const remainingBlocks = this.blocks.slice(completedSteps.length);

    yield {
      type: completedSteps.length > 0 ? 'workflow:restart' : 'workflow:start',
      status: STATUS.RUNNING,
      workflowTitle: this.title,
      workflowDescription: this.description,
      previousState: currentState,
      newState: currentState,
      steps: this.blocks.map(block => ({
        title: block.title,
        status: STATUS.PENDING,
        state: currentState
      })),
      options,
    };

    for (const block of remainingBlocks) {
      // Clone the current state here to prevent mutation of the state
      // when the block is executed. The initial clone in the first pass
      // of the loop is not necessary, but it is needed for every other pass
      // and putting it here makes it easier to see.
      currentState = clone(currentState);
      const previousState = currentState;
      try {
        if (block.type === 'step') {
          currentState = await block.action({
            state: currentState,
            options,
          });
        } else if (block.type === 'workflow') {
          const childInitial = typeof block.initialState === 'function'
            ? block.initialState(currentState)
            : block.initialState;

          // Run inner workflow and yield all its events
          const innerRun = block.innerWorkflow.run({
            initialState: childInitial,
            options,
          });

          let innerCtx;
          for await (const event of innerRun) {
            yield event; // Forward inner workflow events
            if (event.type === 'workflow:complete') {
              innerCtx = event.newState;
            }
          }

          if (!innerCtx) {
            throw new Error('Inner workflow did not complete');
          }

          currentState = block.action(currentState, innerCtx);
        }

        const completedStep = {
          title: block.title,
          status: STATUS.COMPLETE,
          state: currentState
        };
        completedSteps.push(completedStep);

        yield {
          type: 'workflow:update',
          status: STATUS.RUNNING,
          workflowTitle: this.title,
          workflowDescription: this.description,
          previousState,
          newState: currentState,
          completedStep,
          steps: this.blocks.map((b, i) =>
            completedSteps[i] || {
              title: b.title,
              status: STATUS.PENDING,
              state: currentState
            }
          ),
          options,
        };
      } catch (error) {
        const errorStep = {
          title: block.title,
          status: STATUS.ERROR,
          state: currentState
        };
        completedSteps.push(errorStep);

        yield {
          type: 'workflow:error',
          status: STATUS.ERROR,
          workflowTitle: this.title,
          workflowDescription: this.description,
          previousState,
          newState: currentState,
          completedStep: errorStep,
          error: error as SerializedError,
          steps: this.blocks.map((b, i) =>
            completedSteps[i] || {
              title: b.title,
              status: STATUS.PENDING,
              state: currentState
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
      previousState: initialState || {} as TState,
      newState: currentState,
      steps: completedSteps,
      options,
    };

    return currentState;
  }
}