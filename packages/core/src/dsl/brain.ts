import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ObjectGenerator, ToolMessage } from '../clients/types.js';
import type { State, JsonPatch, JsonObject, RuntimeEnv, LoopTool, LoopConfig, LoopMessage, LoopToolWaitFor, RetryConfig } from './types.js';
import { STATUS, BRAIN_EVENTS } from './constants.js';
import { createPatch, applyPatches } from './json-patch.js';
import type { Resources } from '../resources/resources.js';
import type { WebhookRegistration, ExtractWebhookResponses, SerializedWebhookRegistration } from './webhook.js';
import type { PagesService } from './pages.js';
import type { LoopResumeContext } from './loop-messages.js';
import type { UIComponent } from '../ui/types.js';
import { generateUI } from '../ui/generate-ui.js';
import { generatePageHtml } from '../ui/generate-page-html.js';

/**
 * Page object available after a .ui() step.
 * Contains URL to the page and a pre-configured webhook for form submissions.
 *
 * Usage:
 * ```typescript
 * .ui('Create Form', { template: ..., responseSchema: z.object({ name: z.string() }) })
 * .step('Notify', async ({ page, slack }) => {
 *   await slack.post(`Fill out the form: ${page.url}`);
 *   return { state, waitFor: [page.webhook] };
 * })
 * .step('Process', ({ response }) => {
 *   // response.name is typed from responseSchema
 * })
 * ```
 */
export type GeneratedPage<TSchema extends z.ZodSchema = z.ZodSchema> = {
  /** URL where the generated page can be accessed */
  url: string;
  /** Pre-configured webhook for form submissions, typed based on responseSchema */
  webhook: WebhookRegistration<TSchema>;
};

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

/**
 * Default runtime environment used when env is not provided.
 * This ensures backward compatibility with existing code.
 */
export const DEFAULT_ENV: RuntimeEnv = {
  origin: 'http://localhost:3000',
  secrets: {},
};

/**
 * Heartbeat interval in milliseconds.
 * Emits heartbeat events during long-running operations to keep Durable Objects alive.
 */
export const HEARTBEAT_INTERVAL_MS = 5000;

/**
 * Default system prompt prepended to all loop steps.
 * Explains tool execution quirks to the LLM.
 */
const DEFAULT_LOOP_SYSTEM_PROMPT = `## Tool Execution Behavior
- Tools are executed sequentially in the order you call them
- If a tool triggers a webhook (e.g., human approval), remaining tools in your response will NOT execute - you'll need to call them again after resuming
- When waiting on multiple webhooks (e.g., Slack + email), the first webhook response received will resume execution
- Terminal tools end the loop immediately - no further tools or iterations will run

## Resumption Context
When resuming after a webhook response, that response appears as the tool result in your conversation history.`;

/**
 * Simple sleep helper that returns a promise resolving after the specified delay.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Simple semaphore for limiting concurrent operations.
 * Used internally by batch prompt execution.
 */
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release() {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

/**
 * Normalize retry config with defaults.
 */
function normalizeRetryConfig(config?: RetryConfig): Required<RetryConfig> {
  return {
    maxRetries: config?.maxRetries ?? 3,
    backoff: config?.backoff ?? 'exponential',
    initialDelay: config?.initialDelay ?? 1000,
    maxDelay: config?.maxDelay ?? 30000,
  };
}

/**
 * Calculate backoff delay based on attempt number and config.
 */
function calculateBackoff(attempt: number, config: Required<RetryConfig>) {
  switch (config.backoff) {
    case 'none':
      return config.initialDelay;
    case 'linear':
      return Math.min(config.initialDelay * (attempt + 1), config.maxDelay);
    case 'exponential':
      return Math.min(config.initialDelay * Math.pow(2, attempt), config.maxDelay);
  }
}

/**
 * Execute a function with retry and exponential backoff.
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>
) {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < config.maxRetries) {
        const delay = calculateBackoff(attempt, config);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// Shared interface for step action functions
export type StepAction<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWaitFor extends readonly any[] = readonly [],
  TResponseOut extends JsonObject | undefined = undefined,
  TPageIn extends GeneratedPage | undefined = undefined
> = (
  params: {
    state: TStateIn;
    options: TOptions;
    client: ObjectGenerator;
    resources: Resources;
    response: TResponseIn;
    page: TPageIn;
    pages?: PagesService;
    env: RuntimeEnv;
  } & TServices
) =>
  | TStateOut
  | Promise<TStateOut>
  | { state: TStateOut; waitFor: TWaitFor }
  | Promise<{ state: TStateOut; waitFor: TWaitFor }>
  | { state: TStateOut; promptResponse: TResponseOut }
  | Promise<{ state: TStateOut; promptResponse: TResponseOut }>;

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
  initialState?: State; // Only present for START events; RESTART reconstructs state from patches
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
}

// 5. Loop Events
export interface LoopStartEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_START;
  stepTitle: string;
  stepId: string;
  prompt: string;
  system?: string;
}

export interface LoopIterationEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_ITERATION;
  stepTitle: string;
  stepId: string;
  iteration: number;
}

export interface LoopToolCallEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_TOOL_CALL;
  stepTitle: string;
  stepId: string;
  toolName: string;
  toolCallId: string;
  input: JsonObject;
}

export interface LoopToolResultEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_TOOL_RESULT;
  stepTitle: string;
  stepId: string;
  toolName: string;
  toolCallId: string;
  result: unknown;
}

export interface LoopAssistantMessageEvent<
  TOptions extends JsonObject = JsonObject
> extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE;
  stepTitle: string;
  stepId: string;
  content: string;
}

export interface LoopCompleteEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_COMPLETE;
  stepTitle: string;
  stepId: string;
  terminalToolName: string;
  result: JsonObject;
  totalIterations: number;
}

export interface LoopTokenLimitEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_TOKEN_LIMIT;
  stepTitle: string;
  stepId: string;
  totalTokens: number;
  maxTokens: number;
}

export interface LoopWebhookEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.LOOP_WEBHOOK;
  stepTitle: string;
  stepId: string;
  toolCallId: string;
  toolName: string;
  input: JsonObject;
}

export interface WebhookResponseEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.WEBHOOK_RESPONSE;
  response: JsonObject;
}

// 6. Heartbeat Event (emitted during long-running operations to keep DO alive)
export interface HeartbeatEvent<TOptions extends JsonObject = JsonObject>
  extends BaseEvent<TOptions> {
  type: typeof BRAIN_EVENTS.HEARTBEAT;
  stepId: string;
  stepTitle: string;
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
  | WebhookEvent<TOptions>
  | WebhookResponseEvent<TOptions>
  | HeartbeatEvent<TOptions>
  | LoopStartEvent<TOptions>
  | LoopIterationEvent<TOptions>
  | LoopToolCallEvent<TOptions>
  | LoopToolResultEvent<TOptions>
  | LoopAssistantMessageEvent<TOptions>
  | LoopCompleteEvent<TOptions>
  | LoopTokenLimitEvent<TOptions>
  | LoopWebhookEvent<TOptions>;

export interface SerializedStep {
  title: string;
  status: (typeof STATUS)[keyof typeof STATUS];
  id: string;
  patch?: JsonPatch;
  innerSteps?: SerializedStep[]; // For nested brain steps (recursive)
}

// New type for Step Status Event, omitting the patch
export type SerializedStepStatus = Omit<SerializedStep, 'patch'>;

// Type for brain structure
export interface BrainStructure {
  title: string;
  description?: string;
  steps: Array<{
    type: 'step' | 'brain' | 'loop';
    title: string;
    innerBrain?: BrainStructure;
  }>;
}

/**
 * Configuration for creating a brain - either a simple string title
 * or an object with title and optional description.
 */
export type BrainConfig = string | { title: string; description?: string };

type StepBlock<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWebhooks extends readonly any[] = readonly [],
  TPageIn extends GeneratedPage | undefined = undefined
> = {
  type: 'step';
  title: string;
  action: StepAction<
    TStateIn,
    TStateOut,
    TOptions,
    TServices,
    TResponseIn,
    TWebhooks,
    JsonObject | undefined,
    TPageIn
  >;
  /** If true, this is a UI generation step that requires components configuration */
  isUIStep?: boolean;
  /** Configuration for UI generation steps */
  uiConfig?: {
    template: (state: TStateIn, resources: Resources) => string | Promise<string>;
    responseSchema?: z.ZodObject<any>;
  };
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

type LoopBlock<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TTools extends Record<string, LoopTool> = Record<string, LoopTool>
> = {
  type: 'loop';
  title: string;
  configFn: (
    params: {
      state: TStateIn;
      options: TOptions;
      client: ObjectGenerator;
      resources: Resources;
      response: TResponseIn;
      pages?: PagesService;
      env: RuntimeEnv;
    } & TServices
  ) => LoopConfig<TTools> | Promise<LoopConfig<TTools>>;
};

type Block<
  TStateIn,
  TStateOut,
  TOptions extends JsonObject = JsonObject,
  TServices extends object = object,
  TResponseIn extends JsonObject | undefined = undefined,
  TWebhooks extends readonly any[] = readonly [],
  TPageIn extends GeneratedPage | undefined = undefined
> =
  | StepBlock<
      TStateIn,
      TStateOut,
      TOptions,
      TServices,
      TResponseIn,
      TWebhooks,
      TPageIn
    >
  | BrainBlock<TStateIn, any, TStateOut, TOptions, TServices>
  | LoopBlock<TStateIn, TStateOut, TOptions, TServices, TResponseIn>;

interface BaseRunParams<TOptions extends JsonObject = JsonObject> {
  client: ObjectGenerator;
  resources?: Resources;
  options?: TOptions;
  pages?: PagesService;
  env?: RuntimeEnv;
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
  loopResumeContext?: LoopResumeContext | null;
}

export class Brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object,
  TResponse extends JsonObject | undefined = undefined,
  TPage extends GeneratedPage | undefined = undefined
> {
  private blocks: Block<any, any, TOptions, TServices, any, any, any>[] = [];
  public type: 'brain' = 'brain';
  private services: TServices = {} as TServices;
  private optionsSchema?: z.ZodSchema<any>;
  private components?: Record<string, UIComponent<any>>;

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
        } else if (block.type === 'loop') {
          return {
            type: 'loop' as const,
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
  ): Brain<TOptions, TState, TNewServices, TResponse, TPage> {
    const nextBrain = new Brain<TOptions, TState, TNewServices, TResponse, TPage>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Set services
    nextBrain.services = services;
    // Copy optionsSchema to maintain it through the chain
    nextBrain.optionsSchema = this.optionsSchema;
    nextBrain.components = this.components;

    return nextBrain;
  }

  withOptionsSchema<TSchema extends z.ZodSchema>(
    schema: TSchema
  ): Brain<z.infer<TSchema>, TState, TServices, TResponse, TPage> {
    const nextBrain = new Brain<z.infer<TSchema>, TState, TServices, TResponse, TPage>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    nextBrain.optionsSchema = schema;
    nextBrain.services = this.services;
    nextBrain.components = this.components;

    return nextBrain;
  }

  /**
   * Configure UI components for generative UI steps.
   *
   * @param components - Record of component definitions
   *
   * @example
   * ```typescript
   * import { components } from '@positronic/gen-ui-components';
   *
   * const myBrain = brain('my-brain')
   *   .withComponents(components)
   *   .ui('Show Form', formPrompt);
   * ```
   */
  withComponents(
    components: Record<string, UIComponent<any>>
  ): Brain<TOptions, TState, TServices, TResponse, TPage> {
    const nextBrain = new Brain<TOptions, TState, TServices, TResponse, TPage>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    nextBrain.optionsSchema = this.optionsSchema;
    nextBrain.services = this.services;
    nextBrain.components = components;

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
        page: TPage;
        pages?: PagesService;
        env: RuntimeEnv;
      } & TServices
    ) =>
      | TNewState
      | Promise<TNewState>
      | { state: TNewState; waitFor: TWaitFor }
      | Promise<{ state: TNewState; waitFor: TWaitFor }>
  ): Brain<TOptions, TNewState, TServices, ExtractWebhookResponses<TWaitFor>, undefined> {
    const stepBlock: StepBlock<
      TState,
      TNewState,
      TOptions,
      TServices,
      TResponse,
      TWaitFor,
      TPage
    > = {
      type: 'step',
      title,
      action: action as any,
    };
    this.blocks.push(stepBlock);

    return this.nextBrain<TNewState, ExtractWebhookResponses<TWaitFor>, undefined>();
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

  /**
   * Add an agentic loop step that runs an LLM with tools.
   * The loop continues until a terminal tool is called, no tool calls are returned,
   * or maxTokens is exceeded.
   */
  loop<
    TTools extends Record<string, LoopTool> = Record<string, LoopTool>,
    TNewState extends State = TState
  >(
    title: string,
    configFn: (
      params: {
        state: TState;
        options: TOptions;
        client: ObjectGenerator;
        resources: Resources;
        response: TResponse;
        page: TPage;
        pages?: PagesService;
        env: RuntimeEnv;
      } & TServices
    ) => LoopConfig<TTools> | Promise<LoopConfig<TTools>>
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined> {
    const loopBlock: LoopBlock<
      TState,
      TNewState,
      TOptions,
      TServices,
      TResponse,
      TTools
    > = {
      type: 'loop',
      title,
      configFn: configFn as any,
    };
    this.blocks.push(loopBlock);

    return this.nextBrain<TNewState, TResponse, undefined>();
  }

  // TResponseKey:
  // The response key must be a string literal, so if defining a response model
  // a consumer of this brain must use "as const" to ensure the key is a string literal
  // this type makes sure that the will get a ts error if they don't.

  // Overload 1: Single execution - runs prompt once with current state
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
    }
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Overload 2: Batch execution - runs prompt for each item in array
  prompt<
    TItem,
    TResponseKey extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & {
      [K in TResponseKey]: [TItem, z.infer<TSchema>][];
    }
  >(
    title: string,
    config: {
      template: (item: TItem, resources: Resources) => string | Promise<string>;
      outputSchema: {
        schema: TSchema;
        name: TResponseKey & (string extends TResponseKey ? never : unknown);
      };
      client?: ObjectGenerator;
    },
    batchConfig: {
      over: (state: TState) => TItem[];
      concurrency?: number;
      stagger?: number;
      retry?: RetryConfig;
      error?: (item: TItem, error: Error) => z.infer<TSchema> | null;
    }
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Overload 3: Schema-less prompt - returns text response for next step
  prompt(
    title: string,
    config: {
      template: (
        state: TState,
        resources: Resources
      ) => string | Promise<string>;
      client?: ObjectGenerator;
    }
  ): Brain<TOptions, TState, TServices, { text: string }, undefined>;

  // Implementation
  prompt(
    title: string,
    config: {
      template: (input: any, resources: Resources) => string | Promise<string>;
      outputSchema?: {
        schema: z.ZodObject<any>;
        name: string;
      };
      client?: ObjectGenerator;
    },
    batchConfig?: {
      over: (state: any) => any[];
      concurrency?: number;
      stagger?: number;
      retry?: RetryConfig;
      error?: (item: any, error: Error) => any | null;
    }
  ): any {
    // Schema-less prompt - returns text response for next step
    if (!config.outputSchema) {
      const textSchema = z.object({ text: z.string() });
      const promptBlock: StepBlock<
        TState,
        any,
        TOptions,
        TServices,
        TResponse,
        readonly [],
        TPage
      > = {
        type: 'step',
        title,
        action: async ({ state, client: runClient, resources }) => {
          const { template, client: stepClient } = config;
          const client = stepClient ?? runClient;
          const prompt = await template(state, resources);
          const response = await client.generateObject({
            schema: textSchema,
            schemaName: 'TextResponse',
            prompt,
          });
          return {
            state,
            promptResponse: response,
          };
        },
      };
      this.blocks.push(promptBlock);
      return this.nextBrain<any>();
    }
    // At this point, outputSchema is guaranteed to exist (schema-less case returned early)
    const outputSchema = config.outputSchema!;

    if (batchConfig) {
      // Batch mode - run prompt for each item
      const promptBlock: StepBlock<
        TState,
        any,
        TOptions,
        TServices,
        TResponse,
        readonly [],
        TPage
      > = {
        type: 'step',
        title,
        action: async ({ state, client: runClient, resources }) => {
          const { template, client: stepClient } = config;
          const { schema, name: schemaName } = outputSchema;
          const client = stepClient ?? runClient;

          const items = batchConfig.over(state);
          const semaphore = new Semaphore(batchConfig.concurrency ?? 10);
          const stagger = batchConfig.stagger ?? 0;
          const retryConfig = normalizeRetryConfig(batchConfig.retry);

          const results: ([any, any] | undefined)[] = new Array(items.length);

          const promises = items.map(async (item, index) => {
            if (stagger > 0 && index > 0) {
              await sleep(stagger * index);
            }

            await semaphore.acquire();
            try {
              const promptText = await template(item, resources);
              const output = await executeWithRetry(
                () =>
                  client.generateObject({
                    schema,
                    schemaName,
                    prompt: promptText,
                  }),
                retryConfig
              );
              results[index] = [item, output];
            } catch (error) {
              if (batchConfig.error) {
                const fallback = batchConfig.error(item, error as Error);
                if (fallback !== null) {
                  results[index] = [item, fallback];
                }
              } else {
                throw error;
              }
            } finally {
              semaphore.release();
            }
          });

          await Promise.all(promises);

          const finalResults = results.filter(
            (r): r is [any, any] => r !== undefined
          );

          return {
            ...state,
            [outputSchema.name]: finalResults,
          };
        },
      };
      this.blocks.push(promptBlock);
      return this.nextBrain<any>();
    } else {
      // Single mode - run prompt once with current state
      const promptBlock: StepBlock<
        TState,
        any,
        TOptions,
        TServices,
        TResponse,
        readonly [],
        TPage
      > = {
        type: 'step',
        title,
        action: async ({ state, client: runClient, resources }) => {
          const { template, client: stepClient } = config;
          const { schema, name: schemaName } = outputSchema;
          const client = stepClient ?? runClient;
          const prompt = await template(state, resources);
          const response = await client.generateObject({
            schema,
            schemaName,
            prompt,
          });
          return {
            ...state,
            [outputSchema.name]: response,
          };
        },
      };
      this.blocks.push(promptBlock);
      return this.nextBrain<any>();
    }
  }

  /**
   * Add a UI generation step that creates an interactive page.
   *
   * The step:
   * 1. Calls an LLM agent to generate UI components based on the prompt
   * 2. Renders the components to an HTML page
   * 3. Stores the page and makes it available via URL
   * 4. Creates a webhook for form submissions (typed based on responseSchema)
   *
   * The next step receives a `page` object with:
   * - `url`: URL to the generated page
   * - `webhook`: Pre-configured WebhookRegistration for form submissions
   *
   * The brain author is responsible for notifying users about the page (via Slack,
   * email, etc.) and using `waitFor` to pause until the form is submitted.
   * Form data arrives in the `response` parameter of the step after `waitFor`.
   *
   * @example
   * ```typescript
   * brain('feedback-form')
   *   .step('Initialize', () => ({ userName: 'John' }))
   *   .ui('Create Form', {
   *     template: (state) => `Create a feedback form for ${state.userName}`,
   *     responseSchema: z.object({
   *       rating: z.number().min(1).max(5),
   *       comments: z.string(),
   *     }),
   *   })
   *   .step('Notify and Wait', async ({ state, page, slack }) => {
   *     // Notify user however you want
   *     await slack.post('#general', `Please fill out: ${page.url}`);
   *     // Wait for form submission
   *     return { state, waitFor: [page.webhook] };
   *   })
   *   .step('Process Feedback', ({ state, response }) => ({
   *     ...state,
   *     // response is typed: { rating: number, comments: string }
   *     rating: response.rating,
   *     comments: response.comments,
   *   }))
   * ```
   */
  ui<TSchema extends z.ZodObject<any> = z.ZodObject<any>>(
    title: string,
    config: {
      template: (
        state: TState,
        resources: Resources
      ) => string | Promise<string>;
      responseSchema?: TSchema;
    }
  ): Brain<TOptions, TState, TServices, TResponse, GeneratedPage<TSchema>> {
    const uiBlock: StepBlock<
      TState,
      TState,
      TOptions,
      TServices,
      TResponse,
      readonly [],
      TPage
    > = {
      type: 'step',
      title,
      isUIStep: true,
      uiConfig: {
        template: config.template as (state: any, resources: Resources) => string | Promise<string>,
        responseSchema: config.responseSchema,
      },
      action: async (params) => {
        // The actual UI generation is handled by BrainRunner/BrainEventStream
        // This action is a placeholder that gets replaced during execution
        // when the runner detects `isUIStep: true` and has components configured
        throw new Error(
          `UI step "${title}" requires components to be configured via BrainRunner.withComponents(). ` +
          `The UI generation is handled by the runner, not the step action directly.`
        );
      },
    };
    this.blocks.push(uiBlock);

    return this.nextBrain<TState, TResponse, GeneratedPage<TSchema>>();
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
      components: this.components,
    });

    yield* stream.next();
  }

  private withBlocks(
    blocks: Block<any, any, TOptions, TServices, any, any, any>[]
  ): this {
    this.blocks = blocks;
    return this;
  }

  private nextBrain<
    TNewState extends State,
    TNewResponse extends JsonObject | undefined = undefined,
    TNewPage extends GeneratedPage | undefined = undefined
  >(): Brain<TOptions, TNewState, TServices, TNewResponse, TNewPage> {
    // Pass default options to the next brain
    const nextBrain = new Brain<TOptions, TNewState, TServices, TNewResponse, TNewPage>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);

    // Copy services to the next brain
    nextBrain.services = this.services;
    // Copy optionsSchema to the next brain
    nextBrain.optionsSchema = this.optionsSchema;
    // Copy components to the next brain
    nextBrain.components = this.components;

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
  private env: RuntimeEnv;
  private currentResponse: JsonObject | undefined = undefined;
  private currentPage: GeneratedPage | undefined = undefined;
  private loopResumeContext: LoopResumeContext | null | undefined = undefined;
  private initialCompletedSteps?: SerializedStep[];
  private components?: Record<string, UIComponent<any>>;

  constructor(
    params: (InitialRunParams<TOptions> | RerunParams<TOptions>) & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any, any>[];
      services: TServices;
      components?: Record<string, UIComponent<any>>;
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
      env,
      response,
      loopResumeContext,
      components,
    } = params as RerunParams<TOptions> & {
      title: string;
      description?: string;
      blocks: Block<any, any, TOptions, TServices, any, any, any>[];
      services: TServices;
      components?: Record<string, UIComponent<any>>;
    };

    this.initialState = initialState as TState;
    this.title = title;
    this.description = description;
    this.client = client;
    this.options = options;
    this.services = services;
    this.resources = resources;
    this.pages = pages;
    this.env = env ?? DEFAULT_ENV;
    this.initialCompletedSteps = initialCompletedSteps;
    this.components = components;
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

    // Set loop resume context if provided (for loop webhook restarts)
    if (loopResumeContext) {
      this.loopResumeContext = loopResumeContext;
      // Note: We intentionally do NOT set currentResponse here.
      // For loop resumption, the webhook response should flow through
      // the messages array (via loopResumeContext), not through the
      // config function's response parameter. The config function is
      // for loop setup, not for processing webhook responses.
    } else if (response) {
      // Set initial response only for non-loop webhook restarts
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
        // Only include initialState for START events; RESTART reconstructs state from patches
        ...(hasCompletedSteps ? {} : { initialState: currentState }),
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

    if (block.type === 'step') {
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any, any>;

      // Check if this is a UI step - handle specially
      if (stepBlock.isUIStep) {
        yield* this.executeUIStep(step, stepBlock);
        return;
      }
    }

    if (block.type === 'brain') {
      const initialState =
        typeof block.initialState === 'function'
          ? block.initialState(this.currentState)
          : block.initialState;

      // Check if this inner brain step has completed inner steps (for resume)
      const stepIndex = this.steps.indexOf(step);
      const completedStepEntry = this.initialCompletedSteps?.[stepIndex];
      const innerCompletedSteps = completedStepEntry?.innerSteps;

      // Run inner brain and yield all its events
      // Pass brainRunId so inner brain shares outer brain's run ID
      // Pass innerSteps and response for resume scenarios
      let patches: JsonPatch[] = [];

      // If resuming, include patches from already-completed inner steps
      // These won't be re-emitted as STEP_COMPLETE events
      if (innerCompletedSteps) {
        for (const completedStep of innerCompletedSteps) {
          if (completedStep.patch) {
            patches.push(completedStep.patch);
          }
        }
      }

      let innerBrainPaused = false;
      const innerRun = innerCompletedSteps
        ? block.innerBrain.run({
            resources: this.resources,
            client: this.client,
            initialState,
            initialCompletedSteps: innerCompletedSteps,
            options: this.options ?? ({} as TOptions),
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
            response: this.currentResponse,
          })
        : block.innerBrain.run({
            resources: this.resources,
            client: this.client,
            initialState,
            options: this.options ?? ({} as TOptions),
            pages: this.pages,
            env: this.env,
            brainRunId: this.brainRunId,
          });

      for await (const event of innerRun) {
        yield event; // Forward all inner brain events
        if (event.type === BRAIN_EVENTS.STEP_COMPLETE) {
          patches.push(event.patch);
        }
        // If inner brain yielded a WEBHOOK event, it's pausing
        if (event.type === BRAIN_EVENTS.WEBHOOK) {
          innerBrainPaused = true;
        }
        // If inner brain completed, break immediately to prevent hanging
        if (event.type === BRAIN_EVENTS.COMPLETE) {
          break;
        }
      }

      // If inner brain paused for webhook, don't complete the outer brain step
      // The outer brain should also pause
      if (innerBrainPaused) {
        return;
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
    } else if (block.type === 'loop') {
      yield* this.executeLoop(step);
    } else {
      // Get previous state before action
      const prevState = this.currentState;
      const stepBlock = block as StepBlock<any, any, TOptions, TServices, any, any, any>;

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
              page: this.currentPage,
              pages: this.pages,
              env: this.env,
              ...this.services,
            })
          );

          // Use withHeartbeat to emit heartbeat events during long-running operations
          result = yield* this.withHeartbeat(actionPromise, step);
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

      // Extract state from result (handles waitFor and promptResponse cases)
      if (result && typeof result === 'object' && ('waitFor' in result || 'promptResponse' in result)) {
        this.currentState = result.state;
      } else {
        this.currentState = result;
      }
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
          options: this.options,
          brainRunId: this.brainRunId,
        };
      }

      // Handle promptResponse - set currentResponse for next step
      if (result && typeof result === 'object' && 'promptResponse' in result) {
        this.currentResponse = result.promptResponse;
      }

      // Reset currentPage after step consumes it (page is ephemeral)
      this.currentPage = undefined;
    }
  }

  private async *executeLoop(step: Step): AsyncGenerator<BrainEvent<TOptions>> {
    const block = step.block as LoopBlock<any, any, TOptions, TServices, any, any>;
    const prevState = this.currentState;

    // Get loop configuration
    const config = await block.configFn({
      state: this.currentState,
      options: this.options ?? ({} as TOptions),
      client: this.client,
      resources: this.resources,
      response: this.currentResponse,
      page: this.currentPage,
      pages: this.pages,
      env: this.env,
      ...this.services,
    });

    // Reset currentPage after configFn consumes it (page is ephemeral)
    this.currentPage = undefined;

    // Check if we're resuming from a webhook
    let messages: ToolMessage[];
    if (this.loopResumeContext) {
      const resumeContext = this.loopResumeContext;

      // Emit WEBHOOK_RESPONSE event to record the response
      yield {
        type: BRAIN_EVENTS.WEBHOOK_RESPONSE,
        response: resumeContext.webhookResponse,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Emit LOOP_TOOL_RESULT for the pending tool (webhook response injected as tool result)
      yield {
        type: BRAIN_EVENTS.LOOP_TOOL_RESULT,
        stepTitle: step.block.title,
        stepId: step.id,
        toolCallId: resumeContext.pendingToolCallId,
        toolName: resumeContext.pendingToolName,
        result: resumeContext.webhookResponse,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Use restored messages from the resume context
      messages = resumeContext.messages;

      // Clear the context so it's only used once
      this.loopResumeContext = undefined;
    } else {
      // Emit loop start event (only for fresh starts)
      yield {
        type: BRAIN_EVENTS.LOOP_START,
        stepTitle: step.block.title,
        stepId: step.id,
        prompt: config.prompt,
        system: config.system,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Initialize messages for fresh start
      messages = [{ role: 'user', content: config.prompt }];
    }

    // Initialize token tracking
    let totalTokens = 0;
    let iteration = 0;

    // Main loop
    while (true) {
      iteration++;

      // Emit iteration event
      yield {
        type: BRAIN_EVENTS.LOOP_ITERATION,
        stepTitle: step.block.title,
        stepId: step.id,
        iteration,
        options: this.options ?? ({} as TOptions),
        brainRunId: this.brainRunId,
      };

      // Check if client supports generateText
      if (!this.client.generateText) {
        throw new Error(
          'Client does not support generateText. Use a client that implements generateText for loop steps.'
        );
      }

      // Build tools object for the client (description and inputSchema only)
      const toolsForClient: Record<
        string,
        { description: string; inputSchema: z.ZodSchema }
      > = {};
      for (const [name, toolDef] of Object.entries(config.tools)) {
        const tool = toolDef as LoopTool;
        toolsForClient[name] = {
          description: tool.description,
          inputSchema: tool.inputSchema,
        };
      }

      // Prepend default system prompt to user's system prompt
      const systemPrompt = config.system
        ? `${DEFAULT_LOOP_SYSTEM_PROMPT}\n\n${config.system}`
        : DEFAULT_LOOP_SYSTEM_PROMPT;

      // Call the LLM with heartbeat to keep DO alive during long API calls
      const response = yield* this.withHeartbeat(
        this.client.generateText({
          system: systemPrompt,
          messages,
          tools: toolsForClient,
        }),
        step
      );

      // Track tokens
      totalTokens += response.usage.totalTokens;

      // Check max tokens limit
      if (config.maxTokens && totalTokens > config.maxTokens) {
        yield {
          type: BRAIN_EVENTS.LOOP_TOKEN_LIMIT,
          stepTitle: step.block.title,
          stepId: step.id,
          totalTokens,
          maxTokens: config.maxTokens,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        yield* this.completeStep(step, prevState);
        return;
      }

      // Handle assistant text response
      if (response.text) {
        yield {
          type: BRAIN_EVENTS.LOOP_ASSISTANT_MESSAGE,
          stepTitle: step.block.title,
          stepId: step.id,
          content: response.text,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
        messages.push({ role: 'assistant', content: response.text });
      }

      // If no tool calls, loop naturally ends
      if (!response.toolCalls || response.toolCalls.length === 0) {
        yield* this.completeStep(step, prevState);
        return;
      }

      // Process tool calls
      for (const toolCall of response.toolCalls) {
        yield {
          type: BRAIN_EVENTS.LOOP_TOOL_CALL,
          stepTitle: step.block.title,
          stepId: step.id,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.args as JsonObject,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };

        const tool = config.tools[toolCall.toolName];
        if (!tool) {
          throw new Error(`Unknown tool: ${toolCall.toolName}`);
        }

        // Check if this is a terminal tool
        if (tool.terminal) {
          yield {
            type: BRAIN_EVENTS.LOOP_COMPLETE,
            stepTitle: step.block.title,
            stepId: step.id,
            terminalToolName: toolCall.toolName,
            result: toolCall.args as JsonObject,
            totalIterations: iteration,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          // Merge terminal result into state
          this.currentState = { ...this.currentState, ...(toolCall.args as JsonObject) };
          yield* this.completeStep(step, prevState);
          return;
        }

        // Execute non-terminal tool with heartbeat to keep DO alive during long tool executions
        if (tool.execute) {
          const toolResult = yield* this.withHeartbeat(
            Promise.resolve(tool.execute(toolCall.args)),
            step
          );

          // Check if tool returned waitFor
          if (
            toolResult &&
            typeof toolResult === 'object' &&
            'waitFor' in toolResult
          ) {
            const waitForResult = toolResult as LoopToolWaitFor;

            // Normalize waitFor to array (supports single or multiple webhooks)
            const webhooks = Array.isArray(waitForResult.waitFor)
              ? waitForResult.waitFor
              : [waitForResult.waitFor];

            // Emit loop webhook event first (captures pending tool context)
            yield {
              type: BRAIN_EVENTS.LOOP_WEBHOOK,
              stepTitle: step.block.title,
              stepId: step.id,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.args as JsonObject,
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };

            // Then emit webhook event with all webhooks (first response wins)
            yield {
              type: BRAIN_EVENTS.WEBHOOK,
              waitFor: webhooks.map((w) => ({
                slug: w.slug,
                identifier: w.identifier,
              })),
              options: this.options ?? ({} as TOptions),
              brainRunId: this.brainRunId,
            };
            return;
          }

          // Normal tool result
          yield {
            type: BRAIN_EVENTS.LOOP_TOOL_RESULT,
            stepTitle: step.block.title,
            stepId: step.id,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            result: toolResult,
            options: this.options ?? ({} as TOptions),
            brainRunId: this.brainRunId,
          };

          messages.push({
            role: 'tool',
            content: JSON.stringify(toolResult),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
          });
        }
      }
    }
  }

  /**
   * Execute a UI generation step.
   * Generates UI components, renders to HTML, creates page, and sets up webhook.
   */
  private async *executeUIStep(
    step: Step,
    stepBlock: StepBlock<any, any, TOptions, TServices, any, any, any>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const prevState = this.currentState;

    // Validate required configuration
    if (!this.components) {
      throw new Error(
        `UI step "${stepBlock.title}" requires components to be configured via brain.withComponents()`
      );
    }
    if (!this.pages) {
      throw new Error(
        `UI step "${stepBlock.title}" requires pages service to be configured`
      );
    }

    const uiConfig = stepBlock.uiConfig!;

    // Get the prompt from template (with heartbeat for long-running template functions)
    const prompt = await uiConfig.template(this.currentState, this.resources);

    // Generate UI components using the LLM (with heartbeat)
    const uiResult = yield* this.withHeartbeat(
      generateUI({
        client: this.client,
        prompt,
        components: this.components,
        schema: uiConfig.responseSchema,
        data: this.currentState as Record<string, unknown>,
      }),
      step
    );

    if (!uiResult.rootId) {
      // Provide detailed debug information
      const placementCount = uiResult.placements.length;
      const placementInfo = uiResult.placements
        .map(p => `${p.component}(parentId: ${p.parentId ?? 'null'})`)
        .join(', ');

      if (placementCount === 0) {
        throw new Error(
          `UI generation failed for step "${stepBlock.title}" - no components were placed. ` +
          `The LLM may not have called any component tools. ` +
          `LLM response text: ${uiResult.text ?? '(none)'}`
        );
      } else {
        throw new Error(
          `UI generation failed for step "${stepBlock.title}" - no root component found. ` +
          `${placementCount} component(s) were placed but all have a parentId: [${placementInfo}]. ` +
          `The first component should be placed without a parentId to serve as the root.`
        );
      }
    }

    // Create unique identifier for this form submission webhook
    const webhookIdentifier = `${this.brainRunId}-${step.id}`;

    // Construct form action URL for the webhook
    const formAction = `${this.env.origin}/webhooks/system/ui-form?identifier=${encodeURIComponent(webhookIdentifier)}`;

    // Generate HTML page
    const html = generatePageHtml({
      placements: uiResult.placements,
      rootId: uiResult.rootId,
      data: this.currentState as Record<string, unknown>,
      title: stepBlock.title,
      formAction,
    });

    // Store the page (with heartbeat for potential network latency)
    const page = yield* this.withHeartbeat(this.pages.create(html), step);

    // Create webhook registration for form submissions
    // Uses a built-in 'ui-form' webhook slug that the backend knows how to handle
    const webhook: WebhookRegistration = {
      slug: 'ui-form',
      identifier: webhookIdentifier,
      schema: uiConfig.responseSchema ?? z.record(z.unknown()),
    };

    // Set currentPage for the next step to access
    this.currentPage = {
      url: page.url,
      webhook,
    };

    // State doesn't change from UI step - it just sets up the page
    // The next step will receive the page object and can use waitFor
    yield* this.completeStep(step, prevState);
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

  /**
   * Wraps a promise with heartbeat emission to keep Durable Objects alive during long-running operations.
   * Emits HEARTBEAT events at regular intervals while waiting for the promise to resolve.
   */
  private async *withHeartbeat<T>(
    promise: Promise<T>,
    step: Step
  ): AsyncGenerator<BrainEvent<TOptions>, T> {
    // Create a deferred to track completion
    let resolved = false;
    let result: T;
    let error: Error | undefined;

    const promiseHandler = promise
      .then((r) => {
        resolved = true;
        result = r;
      })
      .catch((e) => {
        resolved = true;
        error = e;
      });

    while (!resolved) {
      // Race between the promise and the heartbeat interval
      await Promise.race([promiseHandler, sleep(HEARTBEAT_INTERVAL_MS)]);

      if (!resolved) {
        yield {
          type: BRAIN_EVENTS.HEARTBEAT,
          stepId: step.id,
          stepTitle: step.block.title,
          options: this.options ?? ({} as TOptions),
          brainRunId: this.brainRunId,
        };
      }
    }

    if (error) {
      throw error;
    }

    return result!;
  }
}

const brainNamesAreUnique = process.env.NODE_ENV !== 'test';

const brainNames = new Set<string>();
export const brain = function <
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object
>(brainConfig: BrainConfig) {
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
