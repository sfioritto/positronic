import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import type { PromptClient } from "../clients/types.js";
import type { State, JsonPatch } from "./types.js";
import { STATUS, WORKFLOW_EVENTS } from './constants.js';
import { createPatch, applyPatches } from './json-patch.js';
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
  steps: SerializedStepStatus[];
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

// New type for Step Status Event, omitting the patch
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

type StepBlock<TStateIn, TStateOut, TOptions extends object = {}, TServices extends object = {}> = {
  type: 'step';
  title: string;
  action: (params: {
    state: TStateIn;
    options: TOptions;
    client: PromptClient;
  } & TServices) => TStateOut | Promise<TStateOut>;
};

type WorkflowBlock<
  TOuterState,
  TInnerState extends State,
  TNewState,
  TOptions extends object = {},
  TServices extends object = {}
> = {
  type: 'workflow';
  title: string;
  innerWorkflow: Workflow<TOptions, TInnerState, TServices>;
  initialState: State | ((outerState: TOuterState) => State);
  action: (outerState: TOuterState, innerState: TInnerState, services: TServices) => TNewState;
};

type Block<TStateIn, TStateOut, TOptions extends object = {}, TServices extends object = {}> =
  | StepBlock<TStateIn, TStateOut, TOptions, TServices>
  | WorkflowBlock<TStateIn, any, TStateOut, TOptions, TServices>;

interface BaseRunParams<TOptions extends object = {}, TServices extends object = {}> {
  client: PromptClient;
  options?: TOptions;
}

export interface InitialRunParams<TOptions extends object = {}, TServices extends object = {}> extends BaseRunParams<TOptions, TServices> {
  initialState?: State;
  initialCompletedSteps?: never;
  workflowRunId?: string;
}

export interface RerunParams<TOptions extends object = {}, TServices extends object = {}> extends BaseRunParams<TOptions, TServices> {
  initialState: State;
  initialCompletedSteps: SerializedStep[];
  workflowRunId: string;
}

export class Workflow<
  TOptions extends object = {},
  TState extends State = {},
  TServices extends object = {}
> {
  private blocks: Block<any, any, TOptions, TServices>[] = [];
  public type: 'workflow' = 'workflow';
  private defaultOptions: Partial<TOptions> = {};
  private services: TServices = {} as TServices;

  constructor(
    public readonly title: string,
    private description?: string
  ) {}

  // New method to specify default options
  withOptions(options: Partial<TOptions>): this {
    this.defaultOptions = { ...this.defaultOptions, ...options };
    return this;
  }

  // New method to add services
  withServices<TNewServices extends object>(services: TNewServices): Workflow<TOptions, TState, TNewServices> {
    const nextWorkflow = new Workflow<TOptions, TState, TNewServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Copy default options
    nextWorkflow.withOptions(this.defaultOptions);

    // Set services
    nextWorkflow.services = services;

    return nextWorkflow;
  }

  step<TNewState extends State>(
    title: string,
    action: (params: {
      state: TState;
      options: TOptions;
      client: PromptClient;
    } & TServices) => TNewState | Promise<TNewState>
  ) {
    const stepBlock: StepBlock<TState, TNewState, TOptions, TServices> = {
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
    innerWorkflow: Workflow<TOptions, TInnerState, TServices>,
    action: (params: { state: TState; workflowState: TInnerState; services: TServices }) => TNewState,
    initialState?: State | ((state: TState) => State)
  ) {
    const nestedBlock: WorkflowBlock<
      TState,
      TInnerState,
      TNewState,
      TOptions,
      TServices
    > = {
      type: 'workflow',
      title,
      innerWorkflow,
      initialState: initialState || (() => ({} as State)),
      action: (outerState, innerState, services) => action({ state: outerState, workflowState: innerState, services })
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
      options: TOptions,
      prompt: string
    } & TServices) => TNewState | Promise<TNewState>,
  ) {
    const promptBlock: StepBlock<
      TState,
      TNewState,
      TOptions,
      TServices
    > = {
      type: 'step',
      title,
      action: async ({ state, client: runClient, options, ...services }) => {
        const { template, responseModel, client: stepClient } = config;
        const client = stepClient ?? runClient;
        const promptString = template(state);
        const response = await client.execute(promptString, responseModel);
        const stateWithResponse = {
          ...state,
          [config.responseModel.name]: response
        };

        return reduce
          ? reduce({ state, response, options, prompt: promptString, ...(services as TServices) })
          : stateWithResponse as unknown as TNewState;
      }
    };
    this.blocks.push(promptBlock);
    return this.nextWorkflow<TNewState>();
  }

  // Overload signatures
  run(params: InitialRunParams<TOptions, TServices>): AsyncGenerator<WorkflowEvent<TOptions>>;
  run(params: RerunParams<TOptions, TServices>): AsyncGenerator<WorkflowEvent<TOptions>>;

  // Implementation signature
  async *run(params: InitialRunParams<TOptions, TServices> | RerunParams<TOptions, TServices>): AsyncGenerator<WorkflowEvent<TOptions>> {
    const { title, description, blocks } = this;

    // Merge default options with provided options
    const mergedOptions = {
      ...this.defaultOptions,
      ...(params.options || {})
    } as TOptions;

    const stream = new WorkflowEventStream({
      title,
      description,
      blocks,
      ...params,
      options: mergedOptions,  // Use merged options
      services: this.services  // Use services from the workflow
    });

    yield* stream.next();
  }

  private withBlocks(blocks: Block<any, any, TOptions, TServices>[]): this {
    this.blocks = blocks;
    return this;
  }

  private nextWorkflow<TNewState extends State>(): Workflow<TOptions, TNewState, TServices> {
    // Pass default options to the next workflow
    const nextWorkflow = new Workflow<TOptions, TNewState, TServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Copy default options to the next workflow
    nextWorkflow.withOptions(this.defaultOptions);

    // Copy services to the next workflow
    nextWorkflow.services = this.services;

    return nextWorkflow;
  }
}

class Step {
  public id: string;
  private patch?: JsonPatch | string;
  private status: typeof STATUS[keyof typeof STATUS] = STATUS.PENDING;

  constructor(
    public block: Block<any, any, any, any>,
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

class WorkflowEventStream<TOptions extends object = {}, TState extends State = {}, TServices extends object = {}> {
  private currentState: TState;
  private steps: Step[];
  private currentStepIndex: number = 0;
  private initialState: TState;
  private workflowRunId: string;
  private title: string;
  private description?: string;
  private client: PromptClient;
  private options: TOptions;
  private services: TServices;

  constructor(params: (InitialRunParams<TOptions, TServices> | RerunParams<TOptions, TServices>) & {
    title: string;
    description?: string;
    blocks: Block<any, any, TOptions, TServices>[];
    services: TServices;
  }) {
    const {
      initialState = {} as TState,
      initialCompletedSteps,
      blocks,
      title,
      description,
      workflowRunId: providedWorkflowRunId,
      options = {} as TOptions,
      client,
      services
    } = params;

    this.initialState = initialState as TState;
    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;

    // Initialize steps array with UUIDs and pending status
    this.steps = blocks.map((block, index) => {
      const completedStep = initialCompletedSteps?.[index];
      if (completedStep) {
        return new Step(block, completedStep.id)
          .withStatus(completedStep.status)
          .withPatch(completedStep.patch);
      }
      return new Step(block);
    });

    this.currentState = clone(this.initialState);

    for (const step of this.steps) {
      if (step.serialized.status === STATUS.COMPLETE && step.serialized.patch) {
        this.currentState = applyPatches(this.currentState, [step.serialized.patch]) as TState;
      }
    }

    // Use provided ID if available, otherwise generate one
    this.workflowRunId = providedWorkflowRunId ?? uuidv4();
  }

  async *next(): AsyncGenerator<WorkflowEvent<TOptions>> {
    const {
      steps,
      title: workflowTitle,
      description: workflowDescription,
      currentState,
      options,
      workflowRunId
    } = this;

    try {
      const hasCompletedSteps = steps.some(step => step.serialized.status !== STATUS.PENDING);
      yield {
        type: hasCompletedSteps ? WORKFLOW_EVENTS.RESTART : WORKFLOW_EVENTS.START,
        status: STATUS.RUNNING,
        workflowTitle,
        workflowDescription,
        initialState: currentState,
        options,
        workflowRunId
      };

      // Emit initial step status after workflow starts
      yield {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: steps.map(step => {
          const { patch, ...rest } = step.serialized;
          return rest;
        }),
        options,
        workflowRunId
      };

      // Process each step
      while (this.currentStepIndex < steps.length) {
        const step = steps[this.currentStepIndex];

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
          options,
          workflowRunId
        };

        // Execute step and yield the STEP_COMPLETE event and
        // all events from inner workflows if any
        yield* this.executeStep(step);

        // Step Status Event
        yield {
          type: WORKFLOW_EVENTS.STEP_STATUS,
          steps: steps.map(step => {
            const { patch, ...rest } = step.serialized;
            return rest;
          }),
          options,
          workflowRunId
        };

        this.currentStepIndex++;
      }

      yield {
        type: WORKFLOW_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        workflowTitle,
        workflowDescription,
        workflowRunId,
        options
      };

    } catch (err: any) {
      const error = err as Error;
      const currentStep = steps[this.currentStepIndex];
      currentStep?.withStatus(STATUS.ERROR);

      yield {
        type: WORKFLOW_EVENTS.ERROR,
        status: STATUS.ERROR,
        workflowTitle,
        workflowDescription,
        workflowRunId,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        options
      };

      // Step Status Event
      yield {
        type: WORKFLOW_EVENTS.STEP_STATUS,
        steps: steps.map(step => {
          const { patch, ...rest } = step.serialized;
          return rest;
        }),
        options,
        workflowRunId
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
        client: this.client,
        initialState,
        options: this.options ?? {} as TOptions,
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
      this.currentState = await block.action(this.currentState, innerState, this.services);
      yield* this.completeStep(step, prevState);
    } else {
      // Get previous state before action
      const prevState = this.currentState;

      // Execute regular step
      this.currentState = await block.action({
        state: this.currentState,
        options: this.options ?? {} as TOptions,
        client: this.client,
        ...this.services
      });
      yield* this.completeStep(step, prevState);
    }
  }

  private *completeStep(step: Step, prevState: TState): Generator<WorkflowEvent<TOptions>> {
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
      options: this.options ?? {} as TOptions,
      workflowRunId: this.workflowRunId
    };
  }
}

const workflowNamesAreUnique = process.env.NODE_ENV !== 'test';

const workflowNames = new Set<string>();
export function workflow<
  TOptions extends object = {},
  TState extends State = {},
  TServices extends object = {}
>(
  workflowConfig: string | { title: string; description?: string }
) {
  const title = typeof workflowConfig === 'string' ? workflowConfig : workflowConfig.title;
  const description = typeof workflowConfig === 'string' ? undefined : workflowConfig.description;
  if (workflowNamesAreUnique && workflowNames.has(title)) {
    throw new Error(`Workflow with name "${title}" already exists. Workflow names must be unique.`);
  }
  if (workflowNamesAreUnique) {
    workflowNames.add(title);
  }
  return new Workflow<TOptions, TState, TServices>(title, description);
}

const clone = <T>(value: T): T => structuredClone(value);