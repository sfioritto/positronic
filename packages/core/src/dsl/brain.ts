import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ObjectGenerator } from '../clients/types.js';
import type { State, JsonPatch } from './types.js';
import { STATUS, BRAIN_EVENTS } from './constants.js';
import { createPatch, applyPatches } from './json-patch.js';
import type { Resources } from '../resources/resources.js';

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

// New Event Type System
// Base event interface with only type and options
interface BaseEvent<TOptions extends object = object> {
  type: (typeof BRAIN_EVENTS)[keyof typeof BRAIN_EVENTS];
  options: TOptions;
  brainRunId: string;
}

// 1. Brain Events (all include brain title/description)
interface BrainBaseEvent<TOptions extends object = object>
  extends BaseEvent<TOptions> {
  brainTitle: string;
  brainDescription?: string;
}

export interface BrainStartEvent<TOptions extends object = object>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.START | typeof BRAIN_EVENTS.RESTART;
  initialState: State;
  status: typeof STATUS.RUNNING;
}

export interface BrainCompleteEvent<TOptions extends object = object>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.COMPLETE;
  status: typeof STATUS.COMPLETE;
}

export interface BrainErrorEvent<TOptions extends object = object>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.ERROR;
  status: typeof STATUS.ERROR;
  error: SerializedError;
}

// 2. Step Status Event (just steps array and base event properties)
export interface StepStatusEvent<TOptions extends object = object>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_STATUS;
  steps: SerializedStepStatus[];
}

// 3. Step Events (include step-specific properties)
export interface StepStartedEvent<TOptions extends object = object>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_START;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
}

export interface StepCompletedEvent<TOptions extends object = object>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_COMPLETE;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
  patch: JsonPatch;
}

// Union type of all possible events
export type BrainEvent<TOptions extends object = object> =
  | BrainStartEvent<TOptions>
  | BrainCompleteEvent<TOptions>
  | BrainErrorEvent<TOptions>
  | StepStatusEvent<TOptions>
  | StepStartedEvent<TOptions>
  | StepCompletedEvent<TOptions>;

export interface SerializedStep {
  title: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  id: string;
  patch?: JsonPatch;
}

// New type for Step Status Event, omitting the patch
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

type StepBlock<
  TStateIn,
  TStateOut,
  TOptions extends object = object,
  TServices extends object = object
> = {
  type: 'step';
  title: string;
  action: (
    params: {
      state: TStateIn;
      options: TOptions;
      client: ObjectGenerator;
      resources: Resources;
    } & TServices
  ) => TStateOut | Promise<TStateOut>;
};

type BrainBlock<
  TOuterState,
  TInnerState extends State,
  TNewState,
  TOptions extends object = object,
  TServices extends object = object
> = {
  type: 'brain';
  title: string;
  innerBrain: Brain<TOptions, TInnerState, TServices>;
  initialState: State | ((outerState: TOuterState) => State);
  action: (
    outerState: TOuterState,
    innerState: TInnerState,
    services: TServices
  ) => TNewState;
};

type Block<
  TStateIn,
  TStateOut,
  TOptions extends object = object,
  TServices extends object = object
> =
  | StepBlock<TStateIn, TStateOut, TOptions, TServices>
  | BrainBlock<TStateIn, any, TStateOut, TOptions, TServices>;

interface BaseRunParams<TOptions extends object = object> {
  client: ObjectGenerator;
  resources?: Resources;
  options?: TOptions;
}

export interface InitialRunParams<TOptions extends object = object>
  extends BaseRunParams<TOptions> {
  initialState?: State;
  initialCompletedSteps?: never;
  brainRunId?: string;
}

export interface RerunParams<TOptions extends object = object>
  extends BaseRunParams<TOptions> {
  initialState: State;
  initialCompletedSteps: SerializedStep[];
  brainRunId: string;
}

export class Brain<
  TOptions extends object = object,
  TState extends State = object,
  TServices extends object = object
> {
  private blocks: Block<any, any, TOptions, TServices>[] = [];
  public type: 'brain' = 'brain';
  private defaultOptions: Partial<TOptions> = {};
  private services: TServices = {} as TServices;

  constructor(public readonly title: string, private description?: string) {}

  // New method to specify default options
  withOptions(options: Partial<TOptions>): this {
    this.defaultOptions = { ...this.defaultOptions, ...options };
    return this;
  }

  // New method to add services
  withServices<TNewServices extends object>(
    services: TNewServices
  ): Brain<TOptions, TState, TNewServices> {
    const nextBrain = new Brain<TOptions, TState, TNewServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Copy default options
    nextBrain.withOptions(this.defaultOptions);

    // Set services
    nextBrain.services = services;

    return nextBrain;
  }

  step<TNewState extends State>(
    title: string,
    action: (
      params: {
        state: TState;
        options: TOptions;
        client: ObjectGenerator;
        resources: Resources;
      } & TServices
    ) => TNewState | Promise<TNewState>
  ) {
    const stepBlock: StepBlock<TState, TNewState, TOptions, TServices> = {
      type: 'step',
      title,
      action,
    };
    this.blocks.push(stepBlock);
    return this.nextBrain<TNewState>();
  }

  brain<TInnerState extends State, TNewState extends State>(
    title: string,
    innerBrain: Brain<TOptions, TInnerState, TServices>,
    action: (params: {
      state: TState;
      brainState: TInnerState;
      services: TServices;
    }) => TNewState,
    initialState?: State | ((state: TState) => State)
  ) {
    const nestedBlock: BrainBlock<
      TState,
      TInnerState,
      TNewState,
      TOptions,
      TServices
    > = {
      type: 'brain',
      title,
      innerBrain,
      initialState: initialState || (() => ({} as State)),
      action: (outerState, innerState, services) =>
        action({ state: outerState, brainState: innerState, services }),
    };
    this.blocks.push(nestedBlock);
    return this.nextBrain<TNewState>();
  }

  // TResponseKey:
  // The response key must be a string literal, so if defining a response model
  // a consumer of this brain must use "as const" to ensure the key is a string literal
  // this type makes sure that the will get a ts error if they don't.
  prompt<
    TResponseKey extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & {
      [K in TResponseKey]: z.infer<TSchema>;
    }
  >(
    title: string,
    config: {
      template: (state: TState) => string;
      outputSchema: {
        schema: TSchema;
        name: TResponseKey & (string extends TResponseKey ? never : unknown);
      };
      client?: ObjectGenerator;
    },
    reduce?: (
      params: {
        state: TState;
        response: z.infer<TSchema>;
        options: TOptions;
        prompt: string;
        resources: Resources;
      } & TServices
    ) => TNewState | Promise<TNewState>
  ) {
    const promptBlock: StepBlock<TState, TNewState, TOptions, TServices> = {
      type: 'step',
      title,
      action: async ({
        state,
        client: runClient,
        options,
        resources,
        ...services
      }) => {
        const { template, outputSchema, client: stepClient } = config;
        const { schema, name: schemaName } = outputSchema;
        const client = stepClient ?? runClient;
        const prompt = template(state);
        const response = await client.generateObject({
          schema,
          schemaName,
          prompt,
        });
        const stateWithResponse = {
          ...state,
          [config.outputSchema.name]: response,
        };

        return reduce
          ? reduce({
              state,
              response,
              options,
              prompt,
              resources,
              ...(services as TServices),
            })
          : (stateWithResponse as unknown as TNewState);
      },
    };
    this.blocks.push(promptBlock);
    return this.nextBrain<TNewState>();
  }

  // Overload signatures
  run(params: InitialRunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;
  run(params: RerunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;

  // Implementation signature
  async *run(
    params: InitialRunParams<TOptions> | RerunParams<TOptions>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const { title, description, blocks } = this;

    // Merge default options with provided options
    const mergedOptions = {
      ...this.defaultOptions,
      ...(params.options || {}),
    } as TOptions;

    const stream = new BrainEventStream({
      title,
      description,
      blocks,
      ...params,
      options: mergedOptions,
      services: this.services,
    });

    yield* stream.next();
  }

  private withBlocks(blocks: Block<any, any, TOptions, TServices>[]): this {
    this.blocks = blocks;
    return this;
  }

  private nextBrain<TNewState extends State>(): Brain<
    TOptions,
    TNewState,
    TServices
  > {
    // Pass default options to the next brain
    const nextBrain = new Brain<TOptions, TNewState, TServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Copy default options to the next brain
    nextBrain.withOptions(this.defaultOptions);

    // Copy services to the next brain
    nextBrain.services = this.services;

    return nextBrain;
  }
}

class Step {
  public id: string;
  private patch?: JsonPatch;
  private status: (typeof STATUS)[keyof typeof STATUS] = STATUS.PENDING;

  constructor(public block: Block<any, any, any, any>, id?: string) {
    this.id = id || uuidv4();
  }

  withPatch(patch: JsonPatch | undefined) {
    this.patch = patch;
    return this;
  }

  withStatus(status: (typeof STATUS)[keyof typeof STATUS]) {
    this.status = status;
    return this;
  }

  get serialized(): SerializedStep {
    return {
      id: this.id,
      title: this.block.title,
      status: this.status,
      patch:
        typeof this.patch === 'string' ? JSON.parse(this.patch) : this.patch,
    };
  }
}

class BrainEventStream<
  TOptions extends object = object,
  TState extends State = object,
  TServices extends object = object
> {
  private currentState: TState;
  private steps: Step[];
  private currentStepIndex: number = 0;
  private initialState: TState;
  private brainRunId: string;
  private title: string;
  private description?: string;
  private client: ObjectGenerator;
  private options: TOptions;
  private services: TServices;
  private resources: Resources;

  constructor(
    params: (InitialRunParams<TOptions> | RerunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices>[];
      services: TServices;
    }
  ) {
    const {
      initialState = {} as TState,
      initialCompletedSteps,
      blocks,
      title,
      description,
      brainRunId: providedBrainRunId,
      options = {} as TOptions,
      client,
      services,
      resources = {} as Resources,
    } = params;

    this.initialState = initialState as TState;
    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;
    this.resources = resources;
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
        this.currentState = applyPatches(this.currentState, [
          step.serialized.patch,
        ]) as TState;
      }
    }

    // Use provided ID if available, otherwise generate one
    this.brainRunId = providedBrainRunId ?? uuidv4();
  }

  async *next(): AsyncGenerator<BrainEvent<TOptions>> {
    const {
      steps,
      title: brainTitle,
      description: brainDescription,
      currentState,
      options,
      brainRunId,
    } = this;

    try {
      const hasCompletedSteps = steps.some(
        (step) => step.serialized.status !== STATUS.PENDING
      );
      yield {
        type: hasCompletedSteps ? BRAIN_EVENTS.RESTART : BRAIN_EVENTS.START,
        status: STATUS.RUNNING,
        brainTitle,
        brainDescription,
        initialState: currentState,
        options,
        brainRunId,
      };

      // Emit initial step status after brain starts
      yield {
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: steps.map((step) => {
          const { patch, ...rest } = step.serialized;
          return rest;
        }),
        options,
        brainRunId,
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
          type: BRAIN_EVENTS.STEP_START,
          status: STATUS.RUNNING,
          stepTitle: step.block.title,
          stepId: step.id,
          options,
          brainRunId,
        };

        step.withStatus(STATUS.RUNNING);

        // Step Status Event to indicate that the step is running
        yield {
          type: BRAIN_EVENTS.STEP_STATUS,
          steps: steps.map((step) => {
            const { patch, ...rest } = step.serialized;
            return rest;
          }),
          options,
          brainRunId,
        };

        // Execute step and yield the STEP_COMPLETE event and
        // all events from inner brains if any
        yield* this.executeStep(step);

        // Step Status Event
        yield {
          type: BRAIN_EVENTS.STEP_STATUS,
          steps: steps.map((step) => {
            const { patch, ...rest } = step.serialized;
            return rest;
          }),
          options,
          brainRunId,
        };

        this.currentStepIndex++;
      }

      yield {
        type: BRAIN_EVENTS.COMPLETE,
        status: STATUS.COMPLETE,
        brainTitle,
        brainDescription,
        brainRunId,
        options,
      };
    } catch (err: any) {
      const error = err as Error;
      const currentStep = steps[this.currentStepIndex];
      currentStep?.withStatus(STATUS.ERROR);

      yield {
        type: BRAIN_EVENTS.ERROR,
        status: STATUS.ERROR,
        brainTitle,
        brainDescription,
        brainRunId,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        options,
      };

      // Step Status Event
      yield {
        type: BRAIN_EVENTS.STEP_STATUS,
        steps: steps.map((step) => {
          const { patch, ...rest } = step.serialized;
          return rest;
        }),
        options,
        brainRunId,
      };

      throw error;
    }
  }

  private async *executeStep(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as Block<any, any, TOptions, TServices>;

    if (block.type === 'brain') {
      const initialState =
        typeof block.initialState === 'function'
          ? block.initialState(this.currentState)
          : block.initialState;

      // Run inner brain and yield all its events
      let patches: JsonPatch[] = [];
      const innerRun = block.innerBrain.run({
        resources: this.resources,
        client: this.client,
        initialState,
        options: this.options ?? ({} as TOptions),
      });

      for await (const event of innerRun) {
        yield event; // Forward all inner brain events
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          patches.push(event.patch);
        }
      }

      // Apply collected patches to get final inner state
      const innerState = applyPatches(initialState, patches);

      // Get previous state before action
      const prevState = this.currentState;

      // Update state with inner brain results
      this.currentState = await block.action(
        this.currentState,
        innerState,
        this.services
      );
      yield* this.completeStep(step, prevState);
    } else {
      // Get previous state before action
      const prevState = this.currentState;

      // Execute regular step
      this.currentState = await block.action({
        state: this.currentState,
        options: this.options ?? ({} as TOptions),
        client: this.client,
        resources: this.resources,
        ...this.services,
      });
      yield* this.completeStep(step, prevState);
    }
  }

  private *completeStep(
    step: Step,
    prevState: TState
  ): Generator<BrainEvent<TOptions>> {
    step.withStatus(STATUS.COMPLETE);

    // Create patch for the state change
    const patch = createPatch(prevState, this.currentState);
    step.withPatch(patch);

    yield {
      type: BRAIN_EVENTS.STEP_COMPLETE,
      status: STATUS.RUNNING,
      stepTitle: step.block.title,
      stepId: step.id,
      patch,
      options: this.options ?? ({} as TOptions),
      brainRunId: this.brainRunId,
    };
  }
}

const brainNamesAreUnique = process.env.NODE_ENV !== 'test';

const brainNames = new Set<string>();
export function brain<
  TOptions extends object = object,
  TState extends State = object,
  TServices extends object = object
>(brainConfig: string | { title: string; description?: string }) {
  const title =
    typeof brainConfig === 'string' ? brainConfig : brainConfig.title;
  const description =
    typeof brainConfig === 'string' ? undefined : brainConfig.description;
  if (brainNamesAreUnique && brainNames.has(title)) {
    throw new Error(
      `Brain with name "${title}" already exists. Brain names must be unique.`
    );
  }
  if (brainNamesAreUnique) {
    brainNames.add(title);
  }
  return new Brain<TOptions, TState, TServices>(title, description);
}

const clone = <T>(value: T): T => structuredClone(value);
