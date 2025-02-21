import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import type { PromptClient } from "../clients/types";
import type { State, JsonPatch } from "./types";
import { STATUS, WORKFLOW_EVENTS } from './constants';
import { createPatch, applyPatches } from './json-patch';
import type { FileStore } from "../file-stores/types";

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
}

// New Event Type System
// Base event interface with only type and options
interface BaseEvent<TOptions extends object = {}> {
  type: typeof WORKFLOW_EVENTS[keyof typeof WORKFLOW_EVENTS];
  options: TOptions;
  workflowRunId: string;
}

// 1. Workflow Events (all include workflow title/description)
interface WorkflowBaseEvent<TOptions extends object = {}> extends BaseEvent<TOptions> {
  workflowTitle: string;
  workflowDescription?: string;
}

export interface WorkflowStartEvent<TOptions extends object = {}> extends WorkflowBaseEvent<TOptions> {
  type: typeof WORKFLOW_EVENTS.START | typeof WORKFLOW_EVENTS.RESTART;
  initialState: State;
  status: typeof STATUS.RUNNING;
}

export interface WorkflowCompleteEvent<TOptions extends object = {}> extends WorkflowBaseEvent<TOptions> {
  type: typeof WORKFLOW_EVENTS.COMPLETE;
  status: typeof STATUS.COMPLETE;
}

export interface WorkflowErrorEvent<TOptions extends object = {}> extends WorkflowBaseEvent<TOptions> {
  type: typeof WORKFLOW_EVENTS.ERROR;
  status: typeof STATUS.ERROR;
  error: SerializedError;
}

// 2. Step Status Event (just steps array and base event properties)
export interface StepStatusEvent<TOptions extends object = {}> extends BaseEvent<TOptions> {
  type: typeof WORKFLOW_EVENTS.STEP_STATUS;
  steps: SerializedStep[];
}

// 3. Step Events (include step-specific properties)
export interface StepStartedEvent<TOptions extends object = {}> extends BaseEvent<TOptions> {
  type: typeof WORKFLOW_EVENTS.STEP_START;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
}

export interface StepCompletedEvent<TOptions extends object = {}> extends BaseEvent<TOptions> {
  type: typeof WORKFLOW_EVENTS.STEP_COMPLETE;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
  patch: JsonPatch;
}

// Union type of all possible events
export type WorkflowEvent<TOptions extends object = {}> =
  | WorkflowStartEvent<TOptions>
  | WorkflowCompleteEvent<TOptions>
  | WorkflowErrorEvent<TOptions>
  | StepStatusEvent<TOptions>
  | StepStartedEvent<TOptions>
  | StepCompletedEvent<TOptions>;

export interface SerializedStep {
  title: string;
  status: typeof STATUS[keyof typeof STATUS];
  id: string;
  patch?: JsonPatch;
}

type StepBlock<TStateIn, TStateOut, TOptions extends object = {}> = {
  type: 'step';
  title: string;
  action: (params: {
    state: TStateIn;
    options: TOptions;
    client: PromptClient;
    fileStore: FileStore;
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
  initialState: State | ((outerState: TOuterState) => State);
  action: (outerState: TOuterState, innerState: TInnerState) => TNewState;
};

type Block<TStateIn, TStateOut, TOptions extends object = {}> =
  | StepBlock<TStateIn, TStateOut, TOptions>
  | WorkflowBlock<TStateIn, any, TStateOut, TOptions>;

interface BaseRunParams<TOptions extends object = {}> {
  fileStore: FileStore;
  client: PromptClient;
  options?: TOptions;
}

export interface InitialRunParams<TOptions extends object = {}> extends BaseRunParams<TOptions> {
  initialState?: State;
  initialCompletedSteps?: never;
  workflowRunId?: never;
}

export interface RerunParams<TOptions extends object = {}> extends BaseRunParams<TOptions> {
  initialState: State;
  initialCompletedSteps: SerializedStep[];
  workflowRunId: string;
}

export class Workflow<
  TOptions extends object = {},
  TState extends State = {}
> {
  private blocks: Block<any, any, TOptions>[] = [];
  public type: 'workflow' = 'workflow';

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
      fileStore: FileStore;
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
    initialState?: State | ((state: TState) => State)
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
      initialState: initialState || (() => ({} as State)),
      action: (outerState, innerState) => action({ state: outerState, workflowState: innerState})
    };
    this.blocks.push(nestedBlock);
    return this.nextWorkflow<TNewState>();
  }

  // TResponseKey:
  // The response key must be a string literal, so if defining a response model
  // a consumer of this workflow must use "as const" to ensure the key is a string literal
  // this type makes sure that the will get a ts error if they don't.
  prompt<
    TResponseKey extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & { [K in TResponseKey]: z.infer<TSchema> }
  >(
    title: string,
    config: {
      template: (state: TState) => string;
      responseModel: {
        schema: TSchema;
        name: TResponseKey & (string extends TResponseKey ? never : unknown);
      };
      client?: PromptClient;
    },
    reduce?: (params: {
      state: TState,
      response: z.infer<TSchema>,
      options: TOptions
    }) => TNewState | Promise<TNewState>,
  ) {
    const promptBlock: StepBlock<
      TState,
      TNewState,
      TOptions
    > = {
      type: 'step',
      title,
      action: async ({ state, client: runClient, options }) => {
        const { template, responseModel, client: stepClient } = config;
        const client = stepClient ?? runClient;
        const promptString = template(state);
        const response = await client.execute(promptString, responseModel);
        const stateWithResponse = {
          ...state,
          [config.responseModel.name]: response
        };

        return reduce
          ? reduce({ state, response, options })
          : stateWithResponse as unknown as TNewState;
      }
    };
    this.blocks.push(promptBlock);
    return this.nextWorkflow<TNewState>();
  }

  // Overload signatures
  run(params: InitialRunParams<TOptions>): AsyncGenerator<WorkflowEvent<TOptions>>;
  run(params: RerunParams<TOptions>): AsyncGenerator<WorkflowEvent<TOptions>>;

  // Implementation signature
  async *run(params: InitialRunParams<TOptions> | RerunParams<TOptions>): AsyncGenerator<WorkflowEvent<TOptions>> {
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

class Step {
  public id: string;
  private patch?: JsonPatch | string;
  private status: typeof STATUS[keyof typeof STATUS] = STATUS.PENDING;

  constructor(
    public block: Block<any, any, any>,
    id?: string
  ) {
    this.id = id || uuidv4();
  }

  withPatch(patch: JsonPatch | undefined) {
    this.patch = patch;
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
      patch: typeof this.patch === 'string' ? JSON.parse(this.patch) : this.patch
    };
  }
}

class WorkflowEventStream<TOptions extends object = {}, TState extends State = {}> {
  private currentState: TState;
  private steps: Step[];
  private currentStepIndex: number = 0;
  private initialState: TState;
  private workflowRunId: string;

  constructor(
    private params: (InitialRunParams<TOptions> | RerunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions>[];
    }
  ) {
    this.initialState = (params.initialState ?? {}) as TState;

    // Initialize steps array with UUIDs and pending status
    this.steps = params.blocks.map((block, index) => {
      // Use completed step at same index if available
      const completedStep = params.initialCompletedSteps?.[index];
      if (completedStep) {
        return new Step(block, completedStep.id)
          .withStatus(completedStep.status)
          .withPatch(completedStep.patch);
      }
      return new Step(block);
    });

    // Set initial state by applying patches from completed steps to the initialState
    this.currentState = clone(this.initialState);

    for (const step of this.steps) {
      if (step.serialized.status === STATUS.COMPLETE && step.serialized.patch) {
        this.currentState = applyPatches(this.currentState, [step.serialized.patch]) as TState;
      }
    }

    this.workflowRunId = params.workflowRunId ?? uuidv4();
  }

  async *next(): AsyncGenerator<WorkflowEvent<TOptions>> {
    try {
      // Start event with workflowRunId
      const hasCompletedSteps = this.steps.some(step => step.serialized.status !== STATUS.PENDING);
      yield {
        type: hasCompletedSteps ? WORKFLOW_EVENTS.RESTART : WORKFLOW_EVENTS.START,
        status: STATUS.RUNNING,
        workflowTitle: this.params.title,
        workflowDescription: this.params.description,
        initialState: this.currentState,
        options: this.params.options ?? {} as TOptions,
        workflowRunId: this.workflowRunId
      };

      // Emit initial step status after workflow starts
      yield {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: this.steps.map(step => step.serialized),
        options: this.params.options ?? {} as TOptions,
        workflowRunId: this.workflowRunId
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
          stepTitle: step.block.title,
          stepId: step.id,
          options: this.params.options ?? {} as TOptions,
          workflowRunId: this.workflowRunId
        };

        // Execute step and yield the STEP_COMPLETE event and
        // all events from inner workflows if any
        yield* this.executeStep(step);

        // Step Status Event
        yield {
          type: WORKFLOW_EVENTS.STEP_STATUS,
          steps: this.steps.map(step => step.serialized),
          options: this.params.options ?? {} as TOptions,
          workflowRunId: this.workflowRunId
        };

        this.currentStepIndex++;
      }

      yield {
        type: WORKFLOW_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        workflowTitle: this.params.title,
        workflowDescription: this.params.description,
        workflowRunId: this.workflowRunId,
        options: this.params.options ?? {} as TOptions
      };

    } catch (err: any) {
      const error = err as Error;
      const currentStep = this.steps[this.currentStepIndex];
      currentStep?.withStatus(STATUS.ERROR);

      yield {
        type: WORKFLOW_EVENTS.ERROR,
        status: STATUS.ERROR,
        workflowTitle: this.params.title,
        workflowDescription: this.params.description,
        workflowRunId: this.workflowRunId,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        options: this.params.options ?? {} as TOptions,
      };

      // Step Status Event
      yield {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: this.steps.map(step => step.serialized),
        options: this.params.options ?? {} as TOptions,
        workflowRunId: this.workflowRunId
      };

      throw error;
    }
  }

  private async *executeStep(step: Step): AsyncGenerator<WorkflowEvent<TOptions>> {
    const block = step.block;

    if (block.type === 'workflow') {
      const initialState = typeof block.initialState === 'function'
        ? block.initialState(this.currentState)
        : block.initialState;

      // Run inner workflow and yield all its events
      let patches: JsonPatch[] = [];
      const innerRun = block.innerWorkflow.run({
        fileStore: this.params.fileStore,
        client: this.params.client,
        initialState,
        options: this.params.options ?? {} as TOptions,
      });

      for await (const event of innerRun) {
        yield event;  // Forward all inner workflow events
        if (event.type === WORKFLOW_EVENTS.STEP_COMPLETE) {
          patches.push(event.patch);
        }
      }

      // Apply collected patches to get final inner state
      const innerState = applyPatches(initialState, patches);

      // Get previous state before action
      const prevState = this.currentState;

      // Update state with inner workflow results
      this.currentState = await block.action(this.currentState, innerState);
      step.withStatus(STATUS.COMPLETE);

      // Create patch for the outer state change
      const patch = createPatch(prevState, this.currentState);

      yield {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: step.block.title,
        stepId: step.id,
        patch,
        options: this.params.options ?? {} as TOptions,
        workflowRunId: this.workflowRunId
      };

    } else {
      // Get previous state before action
      const prevState = this.currentState;

      // Execute regular step
      this.currentState = await block.action({
        state: this.currentState,
        options: this.params.options ?? {} as TOptions,
        client: this.params.client,
        fileStore: this.params.fileStore,
      });
      step.withStatus(STATUS.COMPLETE);

      // Create patch for the state change
      const patch = createPatch(prevState, this.currentState);
      step.withPatch(patch);

      yield {
        type: WORKFLOW_EVENTS.STEP_COMPLETE,
        status: STATUS.RUNNING,
        stepTitle: step.block.title,
        stepId: step.id,
        patch,
        options: this.params.options ?? {} as TOptions,
        workflowRunId: this.workflowRunId
      };
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

const clone = <T>(value: T): T => structuredClone(value);