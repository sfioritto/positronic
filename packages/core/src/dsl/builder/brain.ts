import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, LoopTool, LoopConfig, RetryConfig } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { ExtractWebhookResponses } from '../webhook.js';
import type { PagesService } from '../pages.js';
import type { UIComponent } from '../../ui/types.js';

import type { BrainEvent } from '../definitions/events.js';
import type { BrainStructure } from '../definitions/steps.js';
import type { Block, StepBlock, BrainBlock, LoopBlock, StepAction } from '../definitions/blocks.js';
import type { GeneratedPage, BrainConfig } from '../definitions/brain-types.js';
import type { InitialRunParams, RerunParams } from '../definitions/run-params.js';

import { BrainEventStream } from '../execution/event-stream.js';
import { Semaphore, normalizeRetryConfig, executeWithRetry } from '../execution/retry.js';

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
            innerBrain: (block as BrainBlock<any, any, any, TOptions, TServices>).innerBrain.structure,
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

          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
