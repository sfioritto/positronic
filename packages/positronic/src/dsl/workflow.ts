import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import type { PromptClient } from "../clients/types";
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
  currentStep?: SerializedStep;
  steps: SerializedStep[];
  options: TOptions;
}

export interface SerializedStep {
  title: string;
  status: typeof STATUS[keyof typeof STATUS];
  state?: State;
  id: string;
}

type StepBlock<TStateIn, TStateOut, TOptions extends object = {}> = {
  type: 'step';
  title: string;
  action: (params: {
    state: TStateIn;
    options: TOptions;
    client: PromptClient;
  }) => TStateOut | Promise<TStateOut>;
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
  client: PromptClient;
  initialState?: TStateIn;
  options?: TOptions;
  initialCompletedSteps?: SerializedStep[];
}

const clone = <T>(value: T): T => structuredClone(value);

export function workflow<
  TOptions extends object = {},
  TState extends State = {}
>(
  workflowConfig: string | { title: string; description?: string }
) {
  const title = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.title;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  return new Workflow<TOptions, TState>(title, description);
}

export class Workflow<
  TOptions extends object = {},
  TState extends State = {}
> {
  private blocks: Block<any, any, TOptions>[] = [];

  constructor(
    private title: string,
    private description?: string
  ) {}

  step<TNewState extends State>(
    title: string,
    action: (params: {
      state: TState;
      options: TOptions;
      client: PromptClient;
    }) => TNewState | Promise<TNewState>
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
    action: (params: { state: TState; workflowState: TInnerState }) => TNewState,
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
      action: async ({ state, client: runClient }) => {
        const { template, responseModel, client: stepClient } = config;
        const client = stepClient ?? runClient;
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

  async *run(params: RunParams<TOptions, TState>): AsyncGenerator<Event<TState, TState, TOptions>> {
    // Extract client and clone only the serializable properties.
    const { client, ...serializableParams } = params;
    const clonedParams = { client, ...clone(serializableParams) };

    for await (const event of this._run(clonedParams)) {
      yield clone(event);
    }
  }

  private withBlocks(blocks: Block<any, any, TOptions>[]): this {
    this.blocks = blocks;
    return this;
  }

  private nextWorkflow<TNewState extends State>(): Workflow<TOptions, TNewState> {
    return new Workflow<TOptions, TNewState>(
      this.title,
      this.description
    ).withBlocks(this.blocks);
  }

  /**
   * This is separated from the public run() method to centralize all deep cloning
   * operations to ensure that all data that should be cloned to prevent object mutation
   * by consumers of the workflow is in fact cloned. This guarantees that all input and output data is immutable and safe to use by consumers of the workflow.
   */
  private async *_run(params: RunParams<TOptions, TState>) {
    const { client, initialState, options = {} as TOptions, initialCompletedSteps = [] } = params;

    // Initialize steps array with UUIDs and pending status
    const steps = this.blocks.map((block, index) => {
      const completedStep = initialCompletedSteps[index];
      if (completedStep) {
        // Use the existing step exactly as is, including its ID
        return completedStep;
      }
      return {
        id: uuidv4(),
        title: block.title,
        status: STATUS.PENDING
      };
    });

    // Initialize state from completed steps or initial state
    let currentState = initialCompletedSteps?.length > 0
      ? clone(initialCompletedSteps[initialCompletedSteps.length - 1]?.state ?? initialState)
      : clone(initialState || {} as TState);

    // Track current step for event generation
    let currentStep: SerializedStep | undefined;
    let lastCompletedStep: SerializedStep | undefined;
    const currentIndex = initialCompletedSteps.length;

    // Helper function to create events with consistent structure
    const createEvent = <TStateIn extends State, TStateOut extends State>(
      type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS],
      status: typeof STATUS[keyof typeof STATUS],
      additionalProps: Partial<Event<TStateIn, TStateOut, TOptions>> = {}
    ): Event<TStateIn, TStateOut, TOptions> => {
      const previousState = type === WORKFLOW_EVENTS.COMPLETE ? {} as TStateIn : clone(currentState) as TStateIn;
      let stepForEvent: SerializedStep | undefined;

      switch (type) {
        case WORKFLOW_EVENTS.STEP_START:
          stepForEvent = currentStep;
          break;
        case WORKFLOW_EVENTS.STEP_COMPLETE:
        case WORKFLOW_EVENTS.ERROR:
          stepForEvent = lastCompletedStep;
          break;
      }

      return {
        type,
        status,
        workflowTitle: this.title,
        workflowDescription: this.description,
        previousState,
        newState: clone(currentState) as TStateOut,
        steps,
        options,
        currentStep: stepForEvent,
        ...additionalProps
      };
    };

    // Yield start/restart event
    yield createEvent(
      initialCompletedSteps?.length > 0 ? WORKFLOW_EVENTS.RESTART : WORKFLOW_EVENTS.START,
      STATUS.RUNNING
    );

    // Process remaining blocks
    for (let i = currentIndex; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      currentStep = steps[i];

      // Yield step start event
      yield createEvent(WORKFLOW_EVENTS.STEP_START, STATUS.RUNNING);

      try {
        let newState: TState;
        if (block.type === 'step') {
          newState = await block.action({
            state: currentState as TState,
            options,
            client,
          });
        } else {
          const childInitial = typeof block.initialState === 'function'
            ? block.initialState(currentState)
            : block.initialState;

          // Run inner workflow and yield all of its events
          const innerRun = block.innerWorkflow.run({
            client,
            initialState: childInitial,
            options,
          });

          let innerCtx;
          for await (const event of innerRun) {
            yield event; // Yield all events from the inner workflow
            if (event.type === WORKFLOW_EVENTS.COMPLETE) {
              innerCtx = event.newState;
            }
          }

          if (!innerCtx) {
            throw new Error('Inner workflow did not complete');
          }

          newState = block.action(currentState, innerCtx);
        }

        // Update step and state
        steps[i] = {
          ...steps[i],
          status: STATUS.COMPLETE,
          state: clone(newState)
        };
        currentState = clone(newState);
        lastCompletedStep = steps[i];

        yield createEvent(WORKFLOW_EVENTS.STEP_COMPLETE, STATUS.RUNNING);
      } catch (error) {
        // Update step status on error
        steps[i] = {
          ...steps[i],
          status: STATUS.ERROR,
          state: clone(currentState)
        };
        lastCompletedStep = steps[i];

        yield createEvent(
          WORKFLOW_EVENTS.ERROR,
          STATUS.ERROR,
          { error: error as SerializedError }
        );
        throw error;
      }
    }

    // Yield completion event
    yield createEvent(WORKFLOW_EVENTS.COMPLETE, STATUS.COMPLETE);

    return currentState as TState;
  }
}