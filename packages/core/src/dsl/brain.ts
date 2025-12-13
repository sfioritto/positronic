import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ObjectGenerator } from '../clients/types.js';
import type { State, JsonPatch, JsonObject } from './types.js';
import { STATUS, BRAIN_EVENTS } from './constants.js';
import { createPatch, applyPatches } from './json-patch.js';
import type { Resources } from '../resources/resources.js';
import type { WebhookRegistration, ExtractWebhookResponses, SerializedWebhookRegistration } from './webhook.js';
import type { PagesService } from './pages.js';

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

// Shared interface for step action functions
export type StepAction<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWaitFor extends readonly any[] = readonly []
> = (
  params: {
    state: TStateIn;
    options: TOptions;
    client: ObjectGenerator;
    resources: Resources;
    response: TResponseIn;
    pages?: PagesService;
  } & TServices
) =>
  | TStateOut
  | Promise<TStateOut>
  | { state: TStateOut; waitFor: TWaitFor }
  | Promise<{ state: TStateOut; waitFor: TWaitFor }>;

// New Event Type System
// Base event interface with only type and options
interface BaseEvent<TOptions extends JsonObject = JsonObject> {
  type: (typeof BRAIN_EVENTS)[keyof typeof BRAIN_EVENTS];
  options: TOptions;
  brainRunId: string;
}

// 1. Brain Events (all include brain title/description)
interface BrainBaseEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  brainTitle: string;
  brainDescription?: string;
}

export interface BrainStartEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.START | typeof BRAIN_EVENTS.RESTART;
  initialState: State;
  status: typeof STATUS.RUNNING;
}

export interface BrainCompleteEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.COMPLETE;
  status: typeof STATUS.COMPLETE;
}

export interface BrainErrorEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.ERROR;
  status: typeof STATUS.ERROR;
  error: SerializedError;
}

export interface BrainCancelledEvent<TOptions extends JsonObject = JsonObject>
  extends BrainBaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.CANCELLED;
  status: typeof STATUS.CANCELLED;
}

// 2. Step Status Event (just steps array and base event properties)
export interface StepStatusEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_STATUS;
  steps: SerializedStepStatus[];
}

// 3. Step Events (include step-specific properties)
export interface StepStartedEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_START;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
}

export interface StepCompletedEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_COMPLETE;
  status: typeof STATUS.RUNNING;
  stepTitle: string;
  stepId: string;
  patch: JsonPatch;
}

export interface StepRetryEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.STEP_RETRY;
  stepTitle: string;
  stepId: string;
  error: SerializedError;
  attempt: number;
}

// 4. Webhook Event
export interface WebhookEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.WEBHOOK;
  waitFor: SerializedWebhookRegistration[];
  state: State;
}

// Union type of all possible events
export type BrainEvent<TOptions extends JsonObject = JsonObject> =
  | BrainStartEvent<TOptions>
  | BrainCompleteEvent<TOptions>
  | BrainErrorEvent<TOptions>
  | BrainCancelledEvent<TOptions>
  | StepStatusEvent<TOptions>
  | StepStartedEvent<TOptions>
  | StepCompletedEvent<TOptions>
  | StepRetryEvent<TOptions>
  | WebhookEvent<TOptions>;

export interface SerializedStep {
  title: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  id: string;
  patch?: JsonPatch;
}

// New type for Step Status Event, omitting the patch
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

// Type for brain structure
export interface BrainStructure {
  title: string;
  description?: string;
  steps: Array<{
    type: 'step' | 'brain';
    title: string;
    innerBrain?: BrainStructure;
  }>;
}

// Type for the brain function
export interface BrainFactory {
  <
    TOptions extends JsonObject = JsonObject,
    TState extends State = object,
    TServices extends object = object
  >(
    brainConfig: string | { title: string; description?: string }
  ): Brain<TOptions, TState, TServices>;
}

type StepBlock<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWebhooks extends readonly any[] = readonly []
> = {
  type: 'step';
  title: string;
  action: StepAction<
    TStateIn,
    TStateOut,
    TOptions,
    TServices,
    TResponseIn,
    TWebhooks
  >;
};

type BrainBlock<
  TOuterState,
  TInnerState extends State,
  TNewState,
  TOptions extends JsonObject = JsonObject,
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
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWebhooks extends readonly any[] = readonly []
> =
  | StepBlock<
      TStateIn,
      TStateOut,
      TOptions,
      TServices,
      TResponseIn,
      TWebhooks
    >
  | BrainBlock<TStateIn, any, TStateOut, TOptions, TServices>;

interface BaseRunParams<TOptions extends JsonObject = JsonObject> {
  client: ObjectGenerator;
  resources?: Resources;
  options?: TOptions;
  pages?: PagesService;
}

export interface InitialRunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  initialState?: State;
  initialCompletedSteps?: never;
  brainRunId?: string;
}

export interface RerunParams<TOptions extends JsonObject = JsonObject>
  extends BaseRunParams<TOptions> {
  initialState: State;
  initialCompletedSteps: SerializedStep[];
  brainRunId: string;
  response?: JsonObject;
}

export class Brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object,
  TResponse extends JsonObject | undefined = undefined
> {
  private blocks: Block<any, any, TOptions, TServices, any, any>[] = [];
  public type: 'brain' = 'brain';
  private services: TServices = {} as TServices;
  private optionsSchema?: z.ZodSchema<any>;

  constructor(public readonly title: string, private description?: string) {}

  get structure(): BrainStructure {
    return {
      title: this.title,
      description: this.description,
      steps: this.blocks.map((block) => {
        if (block.type === 'step') {
          return {
            type: 'step' as const,
            title: block.title,
          };
        } else {
          // block.type === 'brain'
          return {
            type: 'brain' as const,
            title: block.title,
            innerBrain: block.innerBrain.structure,
          };
        }
      }),
    };
  }

  // New method to add services
  withServices<TNewServices extends object>(
    services: TNewServices
  ): Brain<TOptions, TState, TNewServices, TResponse> {
    const nextBrain = new Brain<TOptions, TState, TNewServices, TResponse>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Set services
    nextBrain.services = services;
    // Copy optionsSchema to maintain it through the chain
    nextBrain.optionsSchema = this.optionsSchema;

    return nextBrain;
  }

  withOptionsSchema<TSchema extends z.ZodSchema>(
    schema: TSchema
  ): Brain<z.infer<TSchema>, TState, TServices, TResponse> {
    const nextBrain = new Brain<z.infer<TSchema>, TState, TServices, TResponse>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    nextBrain.optionsSchema = schema;
    nextBrain.services = this.services;

    return nextBrain;
  }

  step<
    TNewState extends State,
    TWaitFor extends readonly any[] = readonly []
  >(
    title: string,
    action: (
      params: {
        state: TState;
        options: TOptions;
        client: ObjectGenerator;
        resources: Resources;
        response: TResponse;
        pages?: PagesService;
      } & TServices
    ) =>
      | TNewState
      | Promise<TNewState>
      | { state: TNewState; waitFor: TWaitFor }
      | Promise<{ state: TNewState; waitFor: TWaitFor }>
  ): Brain<TOptions, TNewState, TServices, ExtractWebhookResponses<TWaitFor>> {
    const stepBlock: StepBlock<
      TState,
      TNewState,
      TOptions,
      TServices,
      TResponse,
      TWaitFor
    > = {
      type: 'step',
      title,
      action: action as any,
    };
    this.blocks.push(stepBlock);
    
    // Create next brain with inferred response type
    const nextBrain = new Brain<TOptions, TNewState, TServices, ExtractWebhookResponses<TWaitFor>>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);
    
    nextBrain.services = this.services;
    nextBrain.optionsSchema = this.optionsSchema;
    
    return nextBrain;
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
      template: (
        state: TState,
        resources: Resources
      ) => string | Promise<string>;
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
    const promptBlock: StepBlock<
      TState,
      TNewState,
      TOptions,
      TServices,
      TResponse,
      readonly []
    > = {
      type: 'step',
      title,
      action: async ({
        state,
        client: runClient,
        options,
        resources,
        response: webhookResponse,
        ...services
      }) => {
        const { template, outputSchema, client: stepClient } = config;
        const { schema, name: schemaName } = outputSchema;
        const client = stepClient ?? runClient;
        const prompt = await template(state, resources);
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

    // Validate options if schema is defined
    let validatedOptions: TOptions;
    if (this.optionsSchema) {
      // Just call parse - Zod handles defaults automatically
      validatedOptions = this.optionsSchema.parse(
        params.options || {}
      ) as TOptions;
    } else {
      // If no schema is defined but options are provided, throw error
      if (params.options && Object.keys(params.options).length > 0) {
        throw new Error(
          `Brain '${this.title}' received options but no schema was defined. Use withOptionsSchema() to define a schema for options.`
        );
      }
      validatedOptions = {} as TOptions;
    }

    const stream = new BrainEventStream({
      title,
      description,
      blocks,
      ...params,
      options: validatedOptions,
      services: this.services,
    });

    yield* stream.next();
  }

  private withBlocks(
    blocks: Block<any, any, TOptions, TServices, any, any>[]
  ): this {
    this.blocks = blocks;
    return this;
  }

  private nextBrain<
    TNewState extends State,
    TResponse extends JsonObject | undefined = undefined
  >(): Brain<TOptions, TNewState, TServices, TResponse> {
    // Pass default options to the next brain
    const nextBrain = new Brain<TOptions, TNewState, TServices, TResponse>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Copy services to the next brain
    nextBrain.services = this.services;
    // Copy optionsSchema to the next brain
    nextBrain.optionsSchema = this.optionsSchema;

    return nextBrain;
  }

}

const MAX_RETRIES = 1;

class Step {
  public id: string;
  private patch?: JsonPatch;
  private status: (typeof STATUS)[keyof typeof STATUS] = STATUS.PENDING;

  constructor(public block: Block<any, any, any, any, any, any>, id?: string) {
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
  TOptions extends JsonObject = JsonObject,
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
  private pages?: PagesService;
  private currentResponse: JsonObject | undefined = undefined;

  constructor(
    params: (InitialRunParams<TOptions> | RerunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any>[];
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
      pages,
      response,
    } = params as RerunParams<TOptions> & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any>[];
      services: TServices;
    };

    this.initialState = initialState as TState;
    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;
    this.resources = resources;
    this.pages = pages;
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

    // Set initial response if provided (for webhook restarts)
    if (response) {
      this.currentResponse = response;
    }
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
    const block = step.block as Block<any, any, TOptions, TServices, any, any>;

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
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any>;

      // Execute step with automatic retry on failure
      let retries = 0;
      let result;

      while (true) {
        try {
          const actionPromise = Promise.resolve(
            stepBlock.action({
              state: this.currentState,
              options: this.options ?? ({} as TOptions),
              client: this.client,
              resources: this.resources,
              response: this.currentResponse,
              pages: this.pages,
              ...this.services,
            })
          );

          result = await actionPromise;
          break; // Success
        } catch (error) {
          if (retries < MAX_RETRIES) {
            retries++;
            yield {
              type: BRAIN_EVENTS.STEP_RETRY,
              stepTitle: step.block.title,
              stepId: step.id,
              error: {
                name: (error as Error).name,
                message: (error as Error).message,
                stack: (error as Error).stack,
              },
              attempt: retries,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
            // Loop continues to retry
          } else {
            throw error;
          }
        }
      }

      this.currentState = result && typeof result === 'object' && 'waitFor' in result ? result.state : result;
      yield* this.completeStep(step, prevState);

      if (result && typeof result === 'object' && 'waitFor' in result) {
        // Serialize webhook registrations (remove Zod schemas for event serializability)
        const serializedWaitFor: SerializedWebhookRegistration[] = result.waitFor.map(
          (registration: WebhookRegistration) => ({
            slug: registration.slug,
            identifier: registration.identifier,
          })
        );

        yield {
          type: BRAIN_EVENTS.WEBHOOK,
          waitFor: serializedWaitFor,
          state: this.currentState,
          options: this.options,
          brainRunId: this.brainRunId,
        };
      }
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
export const brain: BrainFactory = function <
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object
>(brainConfig: string | { title: string; description?: string }) {
  const title =
    typeof brainConfig === 'string' ? brainConfig : brainConfig.title;
  const description =
    typeof brainConfig === 'string' ? undefined : brainConfig.description;
  if (brainNamesAreUnique && brainNames.has(title)) {
    throw new Error(
      `Brain with title "${title}" already exists. Brain titles must be unique.`
    );
  }
  if (brainNamesAreUnique) {
    brainNames.add(title);
  }
  return new Brain<TOptions, TState, TServices>(title, description);
};

const clone = <T>(value: T): T => structuredClone(value);
