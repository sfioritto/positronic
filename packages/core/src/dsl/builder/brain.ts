import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { State, JsonObject, RuntimeEnv, AgentTool, AgentConfig, AgentOutputSchema, StepContext } from '../types.js';
import type { Resources } from '../../resources/resources.js';
import type { ExtractWebhookResponses } from '../webhook.js';
import type { PagesService } from '../pages.js';
import type { UIComponent } from '../../ui/types.js';
import type { MemoryProvider } from '../../memory/types.js';

import type { BrainEvent } from '../definitions/events.js';
import type { BrainStructure } from '../definitions/steps.js';
import type { Block, StepBlock, BrainBlock, AgentBlock, GuardBlock } from '../definitions/blocks.js';
import type { GeneratedPage, BrainConfig } from '../definitions/brain-types.js';
import type { InitialRunParams, ResumeRunParams } from '../definitions/run-params.js';

import { BrainEventStream } from '../execution/event-stream.js';

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
  private defaultTools?: Record<string, AgentTool>;
  private memoryProvider?: MemoryProvider;

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
        } else if (block.type === 'agent') {
          return {
            type: 'agent' as const,
            title: block.title,
          };
        } else if (block.type === 'guard') {
          return {
            type: 'guard' as const,
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
    nextBrain.defaultTools = this.defaultTools;
    nextBrain.memoryProvider = this.memoryProvider;

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
    nextBrain.defaultTools = this.defaultTools;
    nextBrain.memoryProvider = this.memoryProvider;

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
    nextBrain.defaultTools = this.defaultTools;
    nextBrain.memoryProvider = this.memoryProvider;

    return nextBrain;
  }

  /**
   * Configure default tools for agent steps.
   * These tools will be automatically available in all agent steps and can be
   * extended or overridden in individual step configurations.
   *
   * @param tools - Record of default tool definitions
   *
   * @example
   * ```typescript
   * import { defaultTools } from '@positronic/core';
   *
   * const myBrain = brain('my-brain')
   *   .withTools(defaultTools)
   *   .brain('agent', ({ tools }) => ({
   *     system: 'You are helpful',
   *     prompt: 'Do something',
   *     tools  // uses defaults
   *   }));
   * ```
   */
  withTools<TTools extends Record<string, AgentTool>>(
    tools: TTools
  ): Brain<TOptions, TState, TServices, TResponse, TPage> {
    const next = this.nextBrain<TState, TResponse, TPage>();
    next.defaultTools = tools;
    return next;
  }

  /**
   * Configure a memory provider for this brain.
   * When configured, steps receive a scoped memory instance in their context.
   *
   * @param provider - The memory provider to use
   *
   * @example
   * ```typescript
   * import { createMem0Provider } from '@positronic/mem0';
   *
   * const memory = createMem0Provider({ apiKey: process.env.MEM0_API_KEY });
   *
   * const myBrain = brain('my-brain')
   *   .withMemory(memory)
   *   .brain('agent', async ({ memory }) => {
   *     const prefs = await memory.search('user preferences');
   *     return { system: `User preferences: ${prefs}`, prompt: 'Help me' };
   *   });
   * ```
   */
  withMemory(
    provider: MemoryProvider
  ): Brain<TOptions, TState, TServices, TResponse, TPage> {
    const next = this.nextBrain<TState, TResponse, TPage>();
    next.memoryProvider = provider;
    return next;
  }

  step<
    TNewState extends State,
    TWaitFor extends readonly any[] = readonly []
  >(
    title: string,
    action: (
      params: StepContext<TState, TOptions, TResponse, TPage> & TServices
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

  guard(
    predicate: (params: { state: TState; options: TOptions }) => boolean,
    title?: string
  ): Brain<TOptions, TState, TServices, TResponse, TPage> {
    const guardBlock: GuardBlock<TState, TOptions> = {
      type: 'guard',
      title: title ?? 'Guard',
      predicate,
    };
    this.blocks.push(guardBlock);
    return this.nextBrain<TState, TResponse, TPage>();
  }

  // Overload 1: Nested brain
  brain<TInnerState extends State, TNewState extends State>(
    title: string,
    innerBrain: Brain<TOptions, TInnerState, TServices>,
    action: (params: {
      state: TState;
      brainState: TInnerState;
      services: TServices;
    }) => TNewState,
    initialState?: State | ((state: TState) => State)
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Overload 2: Agent config object WITH outputSchema
  brain<
    TTools extends Record<string, AgentTool>,
    TName extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & { [K in TName]: z.infer<TSchema> }
  >(
    title: string,
    config: AgentConfig<TTools, AgentOutputSchema<TSchema, TName>>
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Overload 3: Agent config function WITH outputSchema
  brain<
    TTools extends Record<string, AgentTool>,
    TName extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & { [K in TName]: z.infer<TSchema> }
  >(
    title: string,
    configFn: (
      params: StepContext<TState, TOptions, TResponse, TPage> & TServices & {
        /** Default tools available for agent steps */
        tools: Record<string, AgentTool>;
      }
    ) => AgentConfig<TTools, AgentOutputSchema<TSchema, TName>> | Promise<AgentConfig<TTools, AgentOutputSchema<TSchema, TName>>>
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Overload 4: Agent config object (no outputSchema)
  brain<
    TTools extends Record<string, AgentTool> = Record<string, AgentTool>,
    TNewState extends State = TState
  >(
    title: string,
    config: AgentConfig<TTools>
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Overload 5: Agent config function (no outputSchema)
  brain<
    TTools extends Record<string, AgentTool> = Record<string, AgentTool>,
    TNewState extends State = TState
  >(
    title: string,
    configFn: (
      params: StepContext<TState, TOptions, TResponse, TPage> & TServices & {
        /** Default tools available for agent steps */
        tools: Record<string, AgentTool>;
      }
    ) => AgentConfig<TTools> | Promise<AgentConfig<TTools>>
  ): Brain<TOptions, TNewState, TServices, TResponse, undefined>;

  // Implementation
  brain(
    title: string,
    innerBrainOrConfig:
      | Brain<any, any, any, any, any>
      | AgentConfig<any, any>
      | ((params: any) => AgentConfig<any, any> | Promise<AgentConfig<any, any>>),
    action?: (params: any) => any,
    initialState?: State | ((state: TState) => State)
  ): any {
    // Case 1: Nested brain instance
    if (
      innerBrainOrConfig &&
      typeof innerBrainOrConfig === 'object' &&
      'type' in innerBrainOrConfig &&
      innerBrainOrConfig.type === 'brain'
    ) {
      const nestedBlock: BrainBlock<TState, any, any, TOptions, TServices> = {
        type: 'brain',
        title,
        innerBrain: innerBrainOrConfig,
        initialState: initialState || (() => ({} as State)),
        action: (outerState, innerState, services) =>
          action!({ state: outerState, brainState: innerState, services }),
      };
      this.blocks.push(nestedBlock);
      return this.nextBrain<any>();
    }

    // Case 2 & 3: Agent config (object or function)
    const configFn =
      typeof innerBrainOrConfig === 'function'
        ? innerBrainOrConfig
        : () => innerBrainOrConfig as AgentConfig<any, any>;

    const agentBlock: AgentBlock<TState, any, TOptions, TServices, TResponse, any, any> = {
      type: 'agent',
      title,
      configFn: configFn as any,
    };
    this.blocks.push(agentBlock);

    return this.nextBrain<any, TResponse, undefined>();
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
      maxRetries?: number;
      error?: (item: TItem, error: Error) => z.infer<TSchema> | null;
      chunkSize?: number;
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
      maxRetries?: number;
      error?: (item: any, error: Error) => any | null;
      chunkSize?: number;
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
      // Batch mode - store config on block for event-stream to execute with per-item events
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
        action: async ({ state }) => state,
        batchConfig: {
          over: batchConfig.over,
          maxRetries: batchConfig.maxRetries,
          error: batchConfig.error,
          template: config.template,
          schema: outputSchema.schema,
          schemaName: outputSchema.name,
          client: config.client,
          chunkSize: batchConfig.chunkSize,
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
  run(params: ResumeRunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;

  // Implementation signature
  async *run(
    params: InitialRunParams<TOptions> | ResumeRunParams<TOptions>
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
      defaultTools: this.defaultTools,
      memoryProvider: this.memoryProvider,
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
    // Copy defaultTools to the next brain
    nextBrain.defaultTools = this.defaultTools;
    // Copy memoryProvider to the next brain
    nextBrain.memoryProvider = this.memoryProvider;

    return nextBrain;
  }
}

const brainNamesAreUnique = process.env.NODE_ENV !== 'test';

const brainNames = new Set<string>();

/**
 * Helper to register a brain name and check for uniqueness
 */
function registerBrainName(title: string): void {
  if (brainNamesAreUnique && brainNames.has(title)) {
    throw new Error(
      `Brain with title "${title}" already exists. Brain titles must be unique.`
    );
  }
  if (brainNamesAreUnique) {
    brainNames.add(title);
  }
}

// Overload 1: Builder pattern with title only
export function brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object
>(title: string): Brain<TOptions, TState, TServices>;

// Overload 2: Builder pattern with config object (title + description)
export function brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object
>(config: { title: string; description?: string }): Brain<TOptions, TState, TServices>;

// Overload 3: Direct agent with config object WITH outputSchema
export function brain<
  TTools extends Record<string, AgentTool>,
  TName extends string & { readonly brand?: unique symbol },
  TSchema extends z.ZodObject<any>,
  TNewState extends State = { [K in TName]: z.infer<TSchema> }
>(
  title: string,
  config: AgentConfig<TTools, AgentOutputSchema<TSchema, TName>>
): Brain<JsonObject, TNewState, object, undefined, undefined>;

// Overload 4: Direct agent with config function WITH outputSchema
export function brain<
  TTools extends Record<string, AgentTool>,
  TName extends string & { readonly brand?: unique symbol },
  TSchema extends z.ZodObject<any>,
  TNewState extends State = { [K in TName]: z.infer<TSchema> }
>(
  title: string,
  configFn: (
    params: StepContext<object, JsonObject, undefined, undefined> & {
      tools: Record<string, AgentTool>;
    }
  ) => AgentConfig<TTools, AgentOutputSchema<TSchema, TName>> | Promise<AgentConfig<TTools, AgentOutputSchema<TSchema, TName>>>
): Brain<JsonObject, TNewState, object, undefined, undefined>;

// Overload 5: Direct agent with config object (no outputSchema)
export function brain<
  TTools extends Record<string, AgentTool> = Record<string, AgentTool>,
  TState extends State = object
>(
  title: string,
  config: AgentConfig<TTools>
): Brain<JsonObject, TState, object, undefined, undefined>;

// Overload 6: Direct agent with config function (no outputSchema)
export function brain<
  TTools extends Record<string, AgentTool> = Record<string, AgentTool>,
  TState extends State = object
>(
  title: string,
  configFn: (
    params: StepContext<object, JsonObject, undefined, undefined> & {
      tools: Record<string, AgentTool>;
    }
  ) => AgentConfig<TTools> | Promise<AgentConfig<TTools>>
): Brain<JsonObject, TState, object, undefined, undefined>;

// Implementation
export function brain(
  titleOrConfig: string | BrainConfig,
  agentConfig?:
    | AgentConfig<any, any>
    | ((params: any) => AgentConfig<any, any> | Promise<AgentConfig<any, any>>)
): Brain<any, any, any, any, any> {
  const title =
    typeof titleOrConfig === 'string' ? titleOrConfig : titleOrConfig.title;
  const description =
    typeof titleOrConfig === 'string' ? undefined : titleOrConfig.description;

  registerBrainName(title);

  const newBrain = new Brain<any, any, any>(title, description);

  // If agentConfig is provided, create a brain with a single 'main' agent step
  if (agentConfig !== undefined) {
    return newBrain.brain('main', agentConfig as any);
  }

  return newBrain;
}
