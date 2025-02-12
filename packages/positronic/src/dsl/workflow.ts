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
  TOptions extends object = {}
> {
  workflowTitle: string;
  workflowDescription?: string;
  type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS];
  status: typeof STATUS[keyof typeof STATUS];
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
  initialState: TInnerState | ((outerState: TOuterState) => TInnerState);
  action: (outerState: TOuterState, innerState: TInnerState) => TNewState;
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

class Step {
  private id: string;
  private currentState?: State;
  private status: typeof STATUS[keyof typeof STATUS] = STATUS.PENDING;

  constructor(
    public block: Block<any, any, any>,
    id?: string
  ) {
    this.id = id || uuidv4();
  }

  get state(): State {
    return clone(this.currentState ?? {} as State);
  }

  withState(state: State | undefined) {
    this.currentState = state ? clone(state) : undefined;
    return this;
  }

  withStatus(status: typeof STATUS[keyof typeof STATUS]) {
    this.status = status;
    return this;
  }

  get serialized(): SerializedStep {
    return {
      id: this.id,
      title: this.block.title,
      status: this.status,
      state: this.state
    };
  }
}

class WorkflowEventStream<TOptions extends object = {}, TState extends State = {}> {
  private currentState: TState;
  private steps: Step[];
  private currentStepIndex: number = 0;

  constructor(
    private params: RunParams<TOptions, TState> & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions>[];
    }
  ) {
    // Initialize steps array with UUIDs and pending status
    this.steps = params.blocks.map((block, index) => {
      // Use completed step at same index if available
      const completedStep = params.initialCompletedSteps?.[index];
      if (completedStep) {
        return new Step(block, completedStep.id)
          .withState(completedStep.state as TState)
          .withStatus(completedStep.status);
      }
      return new Step(block);
    });

    // Set initial state from the last completed step, or use provided initialState
    const lastCompletedStep = params.initialCompletedSteps?.[params.initialCompletedSteps.length - 1];
    this.currentState = lastCompletedStep?.state as TState ?? clone(params.initialState ?? {} as TState);
  }

  async *next(): AsyncGenerator<Event<TOptions>> {
    try {
      // Start event
      const hasCompletedSteps = this.steps.some(step => step.serialized.status !== STATUS.PENDING);
      yield {
        type: hasCompletedSteps ? WORKFLOW_EVENTS.RESTART : WORKFLOW_EVENTS.START,
        status: STATUS.RUNNING,
        workflowTitle: this.params.title,
        workflowDescription: this.params.description,
        steps: this.steps.map(step => step.serialized),
        options: this.params.options ?? {} as TOptions
      };

      // Process each step
      while (this.currentStepIndex < this.steps.length) {
        const step = this.steps[this.currentStepIndex];

        // Skip completed steps
        if (step.serialized.status === STATUS.COMPLETE) {
          this.currentStepIndex++;
          continue;
        }

        // Step start event
        yield {
          type: WORKFLOW_EVENTS.STEP_START,
          status: STATUS.RUNNING,
          workflowTitle: this.params.title,
          workflowDescription: this.params.description,
          steps: this.steps.map(step => step.serialized),
          options: this.params.options ?? {} as TOptions,
          currentStep: step.serialized
        };

        // Execute step and yield any events it produces
        yield* this.executeStep(step);

        // Step complete event
        yield {
          type: WORKFLOW_EVENTS.STEP_COMPLETE,
          status: STATUS.RUNNING,
          workflowTitle: this.params.title,
          workflowDescription: this.params.description,
          steps: this.steps.map(step => step.serialized),
          options: this.params.options ?? {} as TOptions,
          currentStep: step.serialized
        };

        this.currentStepIndex++;
      }

      yield {
        type: WORKFLOW_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        workflowTitle: this.params.title,
        workflowDescription: this.params.description,
        steps: this.steps.map(step => step.serialized),
        options: this.params.options ?? {} as TOptions
      };

    } catch (err: unknown) {
      const error = err as Error;
      const currentStep = this.steps[this.currentStepIndex];
      currentStep?.withStatus(STATUS.ERROR);

      yield {
        type: WORKFLOW_EVENTS.ERROR,
        status: STATUS.ERROR,
        workflowTitle: this.params.title,
        workflowDescription: this.params.description,
        steps: this.steps.map(step => step.serialized),
        options: this.params.options ?? {} as TOptions,
        currentStep: currentStep?.serialized,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      };
      throw error;
    }
  }

  private async *executeStep(step: Step): AsyncGenerator<Event<TOptions>> {
    const block = step.block;

    if (block.type === 'workflow') {
      const initialState = typeof block.initialState === 'function'
        ? block.initialState(this.currentState)
        : block.initialState;

      // Run inner workflow and yield all its events
      let innerState;
      const innerRun = block.innerWorkflow.run({
        client: this.params.client,
        initialState,
        options: this.params.options ?? {} as TOptions,
      });

      for await (const event of innerRun) {
        yield event;  // Forward all inner workflow events
        if (event.type === WORKFLOW_EVENTS.COMPLETE) {
          innerState = event.steps[event.steps.length - 1].state;
        }
      }

      if (!innerState) {
        throw new Error('Inner workflow did not complete');
      }

      // Update state with inner workflow results
      this.currentState = await block.action(this.currentState, innerState);
      step.withState(this.currentState).withStatus(STATUS.COMPLETE);

    } else {
      // Execute regular step
      this.currentState = await block.action({
        state: this.currentState,
        options: this.params.options ?? {} as TOptions,
        client: this.params.client,
      });
      step.withState(this.currentState).withStatus(STATUS.COMPLETE);
    }
  }
}

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
      action: (outerState, innerState) => action({ state: outerState, workflowState: innerState})
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
      template: (state: TState) => string;
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

  async *run(params: RunParams<TOptions, TState>): AsyncGenerator<Event<TOptions>> {
    const stream = new WorkflowEventStream({
      title: this.title,
      description: this.description,
      blocks: this.blocks,
      ...params
    });

    yield* stream.next();
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
}