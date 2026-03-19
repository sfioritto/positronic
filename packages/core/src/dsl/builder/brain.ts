import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { IterateResult } from '../iterate-result.js';
import type {
  State,
  JsonObject,
  AgentTool,
  AgentConfig,
  AgentConfigWithOutput,
  StepContext,
} from '../types.js';

import type {
  WebhookRegistration,
  ExtractWebhookResponses,
  NormalizeToArray,
} from '../webhook.js';
import type { UIComponent } from '../../ui/types.js';
import type { MemoryProvider } from '../../memory/types.js';
import type { StoreSchema, InferStoreTypes, Store } from '../../store/types.js';
import type { ScopedMemory } from '../../memory/types.js';

import type { BrainEvent } from '../definitions/events.js';
import type { BrainStructure } from '../definitions/steps.js';
import type {
  Block,
  StepBlock,
  BrainBlock,
  AgentBlock,
  GuardBlock,
  WaitBlock,
  MapBlock,
  TemplateContext,
} from '../definitions/blocks.js';
import type { GeneratedPage, BrainConfig } from '../definitions/brain-types.js';
import type {
  InitialRunParams,
  ResumeRunParams,
} from '../definitions/run-params.js';

import { Continuation } from './continuation.js';
import { BrainEventStream } from '../execution/event-stream.js';
import { parseDuration } from '../duration.js';

export class Brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TServices extends object = object
> {
  declare readonly __optionsType: TOptions;
  private blocks: Block<any, any, TOptions, TServices, any, any>[] = [];
  public type: 'brain' = 'brain';
  private services: TServices = {} as TServices;
  public optionsSchema?: z.ZodSchema<any>;
  private components?: Record<string, UIComponent<any>>;
  private defaultTools?: Record<string, AgentTool<any>>;
  private extraTools?: Record<string, AgentTool<any>>;
  private memoryProvider?: MemoryProvider;
  private storeSchema?: StoreSchema;

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
        } else if (block.type === 'wait') {
          return {
            type: 'wait' as const,
            title: block.title,
          };
        } else if (block.type === 'map') {
          const mapBlock = block as MapBlock;
          return {
            type: 'map' as const,
            title: block.title,
            ...(mapBlock.innerBrain
              ? { innerBrain: mapBlock.innerBrain.structure }
              : {}),
          };
        } else {
          // block.type === 'brain'
          return {
            type: 'brain' as const,
            title: block.title,
            innerBrain: (
              block as BrainBlock<any, any, any, TOptions, TServices>
            ).innerBrain.structure,
          };
        }
      }),
    };
  }

  // New method to add services
  withServices<TNewServices extends object>(
    services: TNewServices
  ): Brain<TOptions, TState, TNewServices> {
    const nextBrain = new Brain<TOptions, TState, TNewServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.services = services;
    return nextBrain;
  }

  withOptionsSchema<TSchema extends z.ZodSchema>(
    schema: TSchema
  ): Brain<z.infer<TSchema>, TState, TServices> {
    const nextBrain = new Brain<z.infer<TSchema>, TState, TServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.optionsSchema = schema;
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
  ): Brain<TOptions, TState, TServices> {
    const nextBrain = new Brain<TOptions, TState, TServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.components = components;
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
  withTools<TTools extends Record<string, AgentTool<any>>>(
    tools: TTools
  ): Brain<TOptions, TState, TServices> {
    const next = this.nextBrain<TState>();
    next.defaultTools = tools;
    return next;
  }

  /**
   * Add extra tools on top of whatever default tools are already configured.
   * Unlike `withTools()` which replaces defaults, this merges additively.
   *
   * @param tools - Record of additional tool definitions
   *
   * @example
   * ```typescript
   * const myBrain = createBrain({ defaultTools })
   *   ('my-brain')
   *   .withExtraTools({ myCustomTool })
   *   .brain('agent', ({ tools }) => ({
   *     system: 'You are helpful',
   *     prompt: 'Do something',
   *     tools  // includes both defaults and myCustomTool
   *   }));
   * ```
   */
  withExtraTools<TTools extends Record<string, AgentTool<any>>>(
    tools: TTools
  ): Brain<TOptions, TState, TServices> {
    const next = this.nextBrain<TState>();
    next.extraTools = tools;
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
  ): Brain<TOptions, TState, TServices & { memory: ScopedMemory }> {
    const nextBrain = new Brain<
      TOptions,
      TState,
      TServices & { memory: ScopedMemory }
    >(this.title, this.description).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.memoryProvider = provider;
    return nextBrain;
  }

  /**
   * Configure a typed key-value store for this brain.
   * When configured, steps receive a `store` object in their context with typed get/set/delete/has.
   *
   * @param fields - Store field definitions. Plain values are shared; `{ value, perUser: true }` are per-user scoped.
   *
   * @example
   * ```typescript
   * const myBrain = brain('email-digest')
   *   .withStore({
   *     deselectedThreads: [] as string[],
   *     lastDigestDate: '',
   *     theme: { value: 'light', perUser: true },
   *   })
   *   .step('Process', async ({ store }) => {
   *     const deselected = await store.get('deselectedThreads');
   *     await store.set('deselectedThreads', [...deselected, 'new-id']);
   *     return { processed: true };
   *   });
   * ```
   */
  withStore<T extends StoreSchema>(
    storeSchema: T
  ): Brain<TOptions, TState, TServices & { store: Store<InferStoreTypes<T>> }> {
    const nextBrain = new Brain<
      TOptions,
      TState,
      TServices & { store: Store<InferStoreTypes<T>> }
    >(this.title, this.description).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.storeSchema = storeSchema;
    return nextBrain;
  }

  step<TNewState extends State>(
    title: string,
    action: (
      params: StepContext<TState, TOptions> & TServices
    ) => TNewState | Promise<TNewState>
  ): Brain<TOptions, TNewState, TServices> {
    const stepBlock: StepBlock<
      TState,
      TNewState,
      TOptions,
      TServices,
      any,
      any
    > = {
      type: 'step',
      title,
      action: action as any,
    };
    this.blocks.push(stepBlock);

    return this.nextBrain<TNewState>();
  }

  wait<
    TWaitFor extends
      | WebhookRegistration<any>
      | readonly WebhookRegistration<any>[]
  >(
    title: string,
    action: (
      params: StepContext<TState, TOptions> & TServices
    ) => TWaitFor | Promise<TWaitFor>,
    options?: { timeout?: number | string }
  ): Continuation<
    TOptions,
    TState,
    TServices,
    ExtractWebhookResponses<NormalizeToArray<TWaitFor>>
  > {
    const waitBlock: WaitBlock<TState, TOptions, TServices, any> = {
      type: 'wait',
      title,
      action: action as any,
      ...(options?.timeout !== undefined && {
        timeout: parseDuration(options.timeout),
      }),
    };
    this.blocks.push(waitBlock);

    return this.continuationCallbacks<
      ExtractWebhookResponses<NormalizeToArray<TWaitFor>>
    >();
  }

  guard(
    predicate: (params: { state: TState; options: TOptions }) => boolean,
    title?: string
  ): Brain<TOptions, TState, TServices> {
    const guardBlock: GuardBlock<TState, TOptions> = {
      type: 'guard',
      title: title ?? 'Guard',
      predicate,
    };
    this.blocks.push(guardBlock);
    return this.nextBrain<TState>();
  }

  // Overload 1: Nested brain with stateKey
  brain<
    TInnerOptions extends JsonObject,
    TInnerState extends State,
    TStateKey extends string & { readonly brand?: unique symbol },
    TNewState extends State = TState & { [K in TStateKey]: TInnerState }
  >(
    title: string,
    innerBrain: Brain<TInnerOptions, TInnerState, any>,
    config: {
      stateKey: TStateKey & (string extends TStateKey ? never : unknown);
      initialState?:
        | State
        | ((context: StepContext<TState, TOptions> & TServices) => State);
      options?:
        | TInnerOptions
        | ((
            context: StepContext<TState, TOptions> & TServices
          ) => TInnerOptions);
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Overload 2: Agent config object WITH outputSchema (required)
  brain<
    TTools extends Record<string, AgentTool<any>>,
    TName extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & { [K in TName]: z.infer<TSchema> }
  >(
    title: string,
    config: AgentConfigWithOutput<TTools, TSchema, TName>
  ): Brain<TOptions, TNewState, TServices>;

  // Overload 3: Agent config function WITH outputSchema (required)
  brain<
    TTools extends Record<string, AgentTool<any>>,
    TName extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & { [K in TName]: z.infer<TSchema> }
  >(
    title: string,
    configFn: (
      params: StepContext<TState, TOptions> &
        TServices & {
          /** Default tools available for agent steps */
          tools: Record<string, AgentTool<any>>;
        }
    ) =>
      | AgentConfigWithOutput<TTools, TSchema, TName>
      | Promise<AgentConfigWithOutput<TTools, TSchema, TName>>
  ): Brain<TOptions, TNewState, TServices>;

  // Implementation
  brain(
    title: string,
    innerBrainOrConfig:
      | Brain<any, any, any>
      | AgentConfig<any>
      | ((params: any) => AgentConfig<any> | Promise<AgentConfig<any>>),
    configOrUndefined?: { stateKey: string; initialState?: any; options?: any }
  ): any {
    // Case 1: Nested brain instance
    if (
      innerBrainOrConfig &&
      typeof innerBrainOrConfig === 'object' &&
      'type' in innerBrainOrConfig &&
      innerBrainOrConfig.type === 'brain'
    ) {
      const config = configOrUndefined as {
        stateKey: string;
        initialState?: any;
        options?: any;
      };
      const nestedBlock: BrainBlock<TState, any, any, TOptions, TServices> = {
        type: 'brain',
        title,
        innerBrain: innerBrainOrConfig,
        stateKey: config.stateKey,
        initialState: config.initialState,
        options: config.options,
      };
      this.blocks.push(nestedBlock);
      return this.nextBrain<any>();
    }

    // Case 2 & 3: Agent config (object or function)
    const configFn =
      typeof innerBrainOrConfig === 'function'
        ? innerBrainOrConfig
        : () => innerBrainOrConfig as AgentConfig<any>;

    const agentBlock: AgentBlock<TState, any, TOptions, TServices, any, any> = {
      type: 'agent',
      title,
      configFn: configFn as any,
    };
    this.blocks.push(agentBlock);

    return this.nextBrain<any>();
  }

  // TResponseKey:
  // The response key must be a string literal, so if defining a response model
  // a consumer of this brain must use "as const" to ensure the key is a string literal
  // this type makes sure that the will get a ts error if they don't.

  // Overload 1: Single execution - runs prompt once with current state (auto-merges)
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
        context: TemplateContext<TState, TOptions>
      ) => string | Promise<string>;
      outputSchema: TSchema;
      stateKey: TResponseKey & (string extends TResponseKey ? never : unknown);
      client?: ObjectGenerator;
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Overload 2: Schema-less prompt - returns Continuation with text response
  prompt(
    title: string,
    config: {
      template: (
        context: TemplateContext<TState, TOptions>
      ) => string | Promise<string>;
      client?: ObjectGenerator;
    }
  ): Continuation<TOptions, TState, TServices, { text: string }>;

  // Implementation
  prompt(
    title: string,
    config: {
      template: (context: any) => string | Promise<string>;
      outputSchema?: z.ZodObject<any>;
      stateKey?: string;
      client?: ObjectGenerator;
    }
  ): any {
    // Schema-less prompt - returns Continuation with text response
    if (!config.outputSchema) {
      const textSchema = z.object({ text: z.string() });
      const promptBlock: StepBlock<TState, any, TOptions, TServices, any, any> =
        {
          type: 'step',
          title,
          client: config.client,
          action: async ({ state, options, client, resources }) => {
            const prompt = await config.template({
              state,
              options,
              resources,
            });
            const result = await client.generateObject({
              schema: textSchema,
              schemaName: 'TextResponse',
              prompt,
            });
            return {
              state,
              promptResponse: result.object,
            };
          },
        };
      this.blocks.push(promptBlock);
      return this.continuationCallbacks<{ text: string }>();
    }
    // At this point, outputSchema is guaranteed to exist (schema-less case returned early)
    const outputSchema = config.outputSchema!;
    const stateKey = config.stateKey!;

    // Single mode - run prompt once with current state
    const promptBlock: StepBlock<TState, any, TOptions, TServices, any, any> = {
      type: 'step',
      title,
      client: config.client,
      action: async ({ state, options, client, resources }) => {
        const prompt = await config.template({ state, options, resources });
        const result = await client.generateObject({
          schema: outputSchema,
          prompt,
        });
        return {
          ...state,
          [stateKey]: result.object,
        };
      },
    };
    this.blocks.push(promptBlock);
    return this.nextBrain<any>();
  }

  // Overload 1: Brain mode — run an inner brain per item
  map<
    TItems extends any[],
    TInnerOptions extends JsonObject,
    TInnerState extends State,
    TStateKey extends string & { readonly brand?: unique symbol },
    TNewState extends State = TState & {
      [K in TStateKey]: IterateResult<TItems[number], TInnerState>;
    }
  >(
    title: string,
    config: {
      run: Brain<TInnerOptions, TInnerState, any>;
      over: (
        context: StepContext<TState, TOptions> & TServices
      ) => TItems | Promise<TItems>;
      initialState: (item: TItems[number], outerState: TState) => State;
      stateKey: TStateKey & (string extends TStateKey ? never : unknown);
      error?: (item: TItems[number], error: Error) => TInnerState | null;
      options?:
        | TInnerOptions
        | ((
            context: StepContext<TState, TOptions> & TServices
          ) => TInnerOptions);
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Overload 2: Prompt mode — run a prompt per item
  map<
    TItems extends any[],
    TSchema extends z.ZodObject<any>,
    TStateKey extends string & { readonly brand?: unique symbol },
    TNewState extends State = TState & {
      [K in TStateKey]: IterateResult<TItems[number], z.infer<TSchema>>;
    }
  >(
    title: string,
    config: {
      template: (
        context: TemplateContext<TState, TOptions> & {
          item: NoInfer<TItems[number]>;
        }
      ) => string | Promise<string>;
      outputSchema: TSchema;
      client?: ObjectGenerator;
      over: (
        context: StepContext<TState, TOptions> & TServices
      ) => TItems | Promise<TItems>;
      stateKey: TStateKey & (string extends TStateKey ? never : unknown);
      error?: (item: TItems[number], error: Error) => z.infer<TSchema> | null;
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Implementation
  map(
    title: string,
    config: {
      run?: any;
      template?: (context: any) => string | Promise<string>;
      outputSchema?: z.ZodObject<any>;
      client?: ObjectGenerator;
      over: (context: any) => any[] | Promise<any[]>;
      initialState?: (item: any, outerState: any) => State;
      stateKey: string;
      error?: (item: any, error: Error) => any | null;
      options?: any;
    }
  ): Brain<TOptions, any, TServices> {
    const mapBlock: MapBlock = {
      type: 'map',
      title,
      innerBrain: config.run,
      over: config.over,
      initialState: config.initialState,
      stateKey: config.stateKey,
      error: config.error,
      template: config.template,
      outputSchema: config.outputSchema,
      client: config.client,
      options: config.options,
    };
    this.blocks.push(mapBlock);
    return this.nextBrain<any>();
  }

  /**
   * Add a UI generation step that creates an interactive page.
   *
   * When `outputSchema` is provided, the brain automatically suspends after
   * generating the page (waiting for the form submission) and auto-merges
   * the form response onto state under `outputSchema.name`.
   *
   * When no `outputSchema` is provided, the step generates a read-only page
   * and returns the `Brain` directly for continued chaining.
   *
   * Use the optional `notify` callback for side effects (sending Slack messages, etc.)
   * that need access to the generated page URL.
   *
   * @example
   * ```typescript
   * // UI with form submission (auto-merges response onto state)
   * brain('feedback-form')
   *   .step('Initialize', () => ({ userName: 'John' }))
   *   .ui('Create Form', {
   *     template: ({ state }) => `Create a feedback form for ${state.userName}`,
   *     outputSchema: {
   *       schema: z.object({
   *         rating: z.number().min(1).max(5),
   *         comments: z.string(),
   *       }),
   *       name: 'feedback' as const,
   *     },
   *     notify: async ({ page, slack }) => {
   *       await slack.post('#general', `Please fill out: ${page.url}`);
   *     },
   *   })
   *   // No .handle() needed — form data auto-merges onto state.feedback
   *
   * // Read-only UI (returns Brain directly)
   * brain('report')
   *   .ui('Dashboard', {
   *     template: ({ state }) => `Dashboard for ${state.project}`,
   *   })
   *   .step('Next', ({ state }) => state)
   * ```
   */
  // Overload 1: With outputSchema - auto-merges response onto state
  ui<
    TResponseKey extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & {
      [K in TResponseKey]: z.infer<TSchema>;
    }
  >(
    title: string,
    config: {
      template: (
        context: TemplateContext<TState, TOptions>
      ) => string | Promise<string>;
      outputSchema: TSchema;
      stateKey: TResponseKey & (string extends TResponseKey ? never : unknown);
      notify?: (
        context: { page: GeneratedPage<TSchema> } & StepContext<
          TState,
          TOptions
        > &
          TServices
      ) => void | Promise<void>;
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Overload 2: Without outputSchema - returns Brain
  ui(
    title: string,
    config: {
      template: (
        context: TemplateContext<TState, TOptions>
      ) => string | Promise<string>;
      notify?: (
        context: { page: GeneratedPage } & StepContext<TState, TOptions> &
          TServices
      ) => void | Promise<void>;
    }
  ): Brain<TOptions, TState, TServices>;

  // Implementation
  ui(
    title: string,
    config: {
      template: (context: any) => string | Promise<string>;
      outputSchema?: z.ZodObject<any>;
      stateKey?: string;
      notify?: (context: any) => void | Promise<void>;
    }
  ): any {
    const uiBlock: StepBlock<TState, TState, TOptions, TServices, any, any> = {
      type: 'step',
      title,
      isUIStep: true,
      uiConfig: {
        template: config.template as (context: any) => string | Promise<string>,
        outputSchema: config.outputSchema,
        stateKey: config.stateKey,
        notify: config.notify,
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

    if (config.outputSchema) {
      return this.nextBrain<any>();
    }

    return this.nextBrain<TState>();
  }

  // Overload signatures
  run(params: InitialRunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;
  run(params: ResumeRunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;

  // Implementation signature
  async *run(
    params: InitialRunParams<TOptions> | ResumeRunParams<TOptions>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const { title, description, blocks } = this;

    // Build store if withStore() was called and a store provider is given
    const store =
      this.storeSchema && params.storeProvider
        ? params.storeProvider({
            schema: this.storeSchema,
            brainTitle: this.title,
            currentUser: params.currentUser,
          })
        : undefined;

    const stream = new BrainEventStream({
      title,
      description,
      blocks,
      ...params,
      options: (params.options || {}) as TOptions,
      optionsSchema: this.optionsSchema,
      services: { ...(params.services || {}), ...this.services } as TServices,
      components: this.components,
      defaultTools: this.defaultTools,
      extraTools: this.extraTools,
      memoryProvider: this.memoryProvider,
      store,
    });

    yield* stream.next();
  }

  private withBlocks(
    blocks: Block<any, any, TOptions, TServices, any, any>[]
  ): this {
    this.blocks = blocks;
    return this;
  }

  private copyConfigTo(target: Brain<any, any, any>): void {
    target.services = this.services;
    target.optionsSchema = this.optionsSchema;
    target.components = this.components;
    target.defaultTools = this.defaultTools;
    target.extraTools = this.extraTools;
    target.memoryProvider = this.memoryProvider;
    target.storeSchema = this.storeSchema;
  }

  private nextBrain<TNewState extends State>(): Brain<
    TOptions,
    TNewState,
    TServices
  > {
    const nextBrain = new Brain<TOptions, TNewState, TServices>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    return nextBrain;
  }

  private continuationCallbacks<TResponse>(): Continuation<
    TOptions,
    TState,
    TServices,
    TResponse
  > {
    const blocks = this.blocks;
    const self = this;
    return new Continuation<TOptions, TState, TServices, TResponse>(
      (block) => blocks.push(block),
      <TNewState extends State>() => {
        const next = new Brain<TOptions, TNewState, TServices>(
          self.title,
          self.description
        ).withBlocks(blocks as any);
        self.copyConfigTo(next);
        return next;
      }
    );
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
>(config: {
  title: string;
  description?: string;
}): Brain<TOptions, TState, TServices>;

// Overload 3: Direct agent with config object WITH outputSchema (required)
export function brain<
  TTools extends Record<string, AgentTool<any>>,
  TName extends string & { readonly brand?: unique symbol },
  TSchema extends z.ZodObject<any>,
  TNewState extends State = { [K in TName]: z.infer<TSchema> }
>(
  title: string,
  config: AgentConfigWithOutput<TTools, TSchema, TName>
): Brain<JsonObject, TNewState, object>;

// Overload 4: Direct agent with config function WITH outputSchema (required)
export function brain<
  TTools extends Record<string, AgentTool<any>>,
  TName extends string & { readonly brand?: unique symbol },
  TSchema extends z.ZodObject<any>,
  TNewState extends State = { [K in TName]: z.infer<TSchema> }
>(
  title: string,
  configFn: (
    params: StepContext<object, JsonObject> & {
      tools: Record<string, AgentTool<any>>;
    }
  ) =>
    | AgentConfigWithOutput<TTools, TSchema, TName>
    | Promise<AgentConfigWithOutput<TTools, TSchema, TName>>
): Brain<JsonObject, TNewState, object>;

// Implementation
export function brain(
  titleOrConfig: string | BrainConfig,
  agentConfig?:
    | AgentConfig<any>
    | ((params: any) => AgentConfig<any> | Promise<AgentConfig<any>>)
): Brain<any, any, any> {
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
