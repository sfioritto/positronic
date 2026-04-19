import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { IterateResult } from '../iterate-result.js';
import type { State, JsonObject, StepContext, CurrentUser } from '../types.js';

import type {
  WebhookRegistration,
  ExtractWebhookResponses,
  NormalizeToArray,
} from '../webhook.js';
import type { StoreSchema, InferStoreTypes, Store } from '../../store/types.js';
import type {
  ConfiguredPlugin,
  PluginInjection,
  PluginAdapter,
  PluginCreateReturn,
  PluginsFrom,
} from '../../plugins/types.js';

import type { BrainEvent } from '../definitions/events.js';
import type { BrainStructure } from '../definitions/steps.js';
import type {
  Block,
  StepBlock,
  BrainBlock,
  GuardBlock,
  WaitBlock,
  MapBlock,
  MapConfig,
  PageConfig,
  PromptBlock,
  PromptConfig,
  PromptLoopConfig,
  TemplateReturn,
} from '../definitions/blocks.js';
import type { GeneratedPage, BrainConfig } from '../definitions/brain-types.js';
import {
  resolveTemplate,
  buildTemplateContext,
} from '../../template/render.js';
import type { TemplateChild } from '../../jsx-runtime.js';
import type { FileHandle } from '../../files/types.js';
import { guessMimeType } from '../../files/mime.js';
import type {
  InitialRunParams,
  ResumeRunParams,
} from '../definitions/run-params.js';

import { Continuation } from './continuation.js';
import { BrainEventStream } from '../execution/event-stream.js';
import { parseDuration } from '../duration.js';

/**
 * Merge parent and own plugin configs, call create() for each, separate adapters from injections.
 */
function resolvePlugins(
  parentConfigs: ConfiguredPlugin[],
  ownConfigs: ConfiguredPlugin[],
  ctx: { brainTitle: string; currentUser: CurrentUser; brainRunId: string }
) {
  // Own configs override parent by plugin name
  const merged = [
    ...parentConfigs.filter(
      (p) => !ownConfigs.some((own) => own.__plugin.name === p.__plugin.name)
    ),
    ...ownConfigs,
  ];

  const injections: Record<string, any> = {};
  const adapters: PluginAdapter[] = [];

  for (const configured of merged) {
    const { __plugin: plugin, __config: config } = configured;
    const { adapter, ...injection } = plugin.create({
      config,
      brainTitle: ctx.brainTitle,
      currentUser: ctx.currentUser,
      brainRunId: ctx.brainRunId,
    });
    injections[plugin.name] = injection;
    if (adapter) {
      adapters.push(adapter);
    }
  }

  return { injections, adapters, configs: merged };
}

export class Brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TPlugins extends object = object
> {
  declare readonly __optionsType: TOptions;
  private blocks: Block<any, any, TOptions, TPlugins, any, any>[] = [];
  public type: 'brain' = 'brain';
  public optionsSchema?: z.ZodSchema<any>;
  private storeSchema?: StoreSchema;
  private pluginConfigs: ConfiguredPlugin[] = [];
  private brainClient?: ObjectGenerator;

  constructor(
    public readonly title: string,
    private description?: string,
    brainClient?: ObjectGenerator
  ) {
    this.brainClient = brainClient;
  }

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
          return {
            type: 'map' as const,
            title: block.title,
          };
        } else if (block.type === 'prompt') {
          return {
            type: 'prompt' as const,
            title: block.title,
          };
        } else {
          // block.type === 'brain'
          return {
            type: 'brain' as const,
            title: block.title,
            innerBrain: (block as BrainBlock<any, any, any, TOptions, TPlugins>)
              .innerBrain.structure,
          };
        }
      }),
    };
  }

  withOptions<TSchema extends z.ZodObject>(
    schema: TSchema
  ): Brain<
    z.infer<TSchema> extends JsonObject ? z.infer<TSchema> : never,
    TState,
    TPlugins
  > {
    const nextBrain = new Brain<
      z.infer<TSchema> extends JsonObject ? z.infer<TSchema> : never,
      TState,
      TPlugins
    >(this.title, this.description).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.optionsSchema = schema;
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
  ): Brain<TOptions, TState, TPlugins & { store: Store<InferStoreTypes<T>> }> {
    const nextBrain = new Brain<
      TOptions,
      TState,
      TPlugins & { store: Store<InferStoreTypes<T>> }
    >(this.title, this.description).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.storeSchema = storeSchema;
    return nextBrain;
  }

  /**
   * Add a plugin to this brain. The plugin's create() is called per brain run,
   * and its return value is placed on StepContext under the plugin name.
   *
   * Replaces any existing plugin with the same name.
   */
  withPlugin<TName extends string, TConfig, TCreate extends PluginCreateReturn>(
    plugin: ConfiguredPlugin<TName, TConfig, TCreate>
  ): Brain<
    TOptions,
    TState,
    TPlugins & { [K in TName]: PluginInjection<TCreate> }
  > {
    const nextBrain = new Brain<
      TOptions,
      TState,
      TPlugins & { [K in TName]: PluginInjection<TCreate> }
    >(this.title, this.description).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    nextBrain.pluginConfigs = [
      ...this.pluginConfigs.filter(
        (p) => p.__plugin.name !== plugin.__plugin.name
      ),
      plugin,
    ];
    return nextBrain;
  }

  step<TNewState extends State>(
    title: string,
    action: (
      params: StepContext<TState, TOptions> & TPlugins
    ) => TNewState | Promise<TNewState>
  ): Brain<TOptions, TNewState, TPlugins> {
    const stepBlock: StepBlock<
      TState,
      TNewState,
      TOptions,
      TPlugins,
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
      params: StepContext<TState, TOptions> & TPlugins
    ) => TWaitFor | Promise<TWaitFor>,
    options?: { timeout?: number | string }
  ): Continuation<
    TOptions,
    TState,
    TPlugins,
    ExtractWebhookResponses<NormalizeToArray<TWaitFor>>
  > {
    const waitBlock: WaitBlock<TState, TOptions, TPlugins, any> = {
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
    predicate: (params: StepContext<TState, TOptions> & TPlugins) => boolean,
    title?: string
  ): Brain<TOptions, TState, TPlugins> {
    const guardBlock: GuardBlock<TState, TOptions> = {
      type: 'guard',
      title: title ?? 'Guard',
      predicate,
    };
    this.blocks.push(guardBlock);
    return this.nextBrain<TState>();
  }

  // Nested brain — spreads inner brain's final state onto outer state
  brain<
    TInnerOptions extends JsonObject,
    TInnerState extends State,
    TNewState extends State = TState & TInnerState
  >(
    title: string,
    innerBrain: Brain<TInnerOptions, TInnerState, any>,
    config?: {
      initialState?:
        | State
        | ((context: StepContext<TState, TOptions> & TPlugins) => State);
      options?:
        | TInnerOptions
        | ((
            context: StepContext<TState, TOptions> & TPlugins
          ) => TInnerOptions);
    }
  ): Brain<TOptions, TNewState, TPlugins> {
    const nestedConfig = config ?? {};
    const nestedBlock: BrainBlock<TState, any, any, TOptions, TPlugins> = {
      type: 'brain',
      title,
      innerBrain,
      initialState: nestedConfig.initialState,
      options: nestedConfig.options,
    };
    this.blocks.push(nestedBlock);
    return this.nextBrain<any>();
  }

  prompt<
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & z.infer<TSchema>
  >(
    title: string,
    configFn: (
      context: StepContext<TState, TOptions> & TPlugins
    ) => PromptConfig<TSchema> | Promise<PromptConfig<TSchema>>
  ): Brain<TOptions, TNewState, TPlugins> {
    const promptBlock: PromptBlock = {
      type: 'prompt',
      title,
      configFn: configFn as any,
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
    stateKey: TStateKey & (string extends TStateKey ? never : unknown),
    configFn: (context: StepContext<TState, TOptions> & TPlugins) => {
      run: Brain<TInnerOptions, TInnerState, any>;
      over: TItems | Promise<TItems>;
      initialState: (item: TItems[number]) => State;
      error?: (item: TItems[number], error: Error) => TInnerState | null;
      options?: TInnerOptions;
    }
  ): Brain<TOptions, TNewState, TPlugins>;

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
    stateKey: TStateKey & (string extends TStateKey ? never : unknown),
    configFn: (context: StepContext<TState, TOptions> & TPlugins) => {
      prompt: {
        message: (
          item: NoInfer<TItems[number]>,
          context?: StepContext<TState, TOptions> & TPlugins
        ) => TemplateReturn;
        system?:
          | TemplateReturn
          | ((
              item: NoInfer<TItems[number]>,
              context?: StepContext<TState, TOptions> & TPlugins
            ) => TemplateReturn);
        outputSchema: TSchema;
        loop?: PromptLoopConfig;
      };
      client?: ObjectGenerator;
      over: TItems | Promise<TItems>;
      error?: (item: TItems[number], error: Error) => z.infer<TSchema> | null;
    }
  ): Brain<TOptions, TNewState, TPlugins>;

  // Implementation
  map(
    title: string,
    stateKey: string,
    configFn: (context: any) => MapConfig | Promise<MapConfig>
  ): Brain<TOptions, any, TPlugins> {
    const mapBlock: MapBlock = {
      type: 'map',
      title,
      stateKey,
      configFn,
    };
    this.blocks.push(mapBlock);
    return this.nextBrain<any>();
  }

  // Overload 1: Generated page with outputSchema (auto-merge response onto state)
  page<
    TOutputSchema extends z.ZodObject<any>,
    TNewState extends State = TState & z.infer<TOutputSchema>
  >(
    title: string,
    configFn: (context: StepContext<TState, TOptions> & TPlugins) => {
      message: TemplateReturn;
      inputData: unknown;
      outputSchema: TOutputSchema;
      system?: TemplateReturn;
      onCreated?: (page: GeneratedPage<TOutputSchema>) => void | Promise<void>;
      slug?: string;
      ttl?: number;
      persist?: boolean;
    }
  ): Brain<TOptions, TNewState, TPlugins>;

  // Overload 2: Generated page without outputSchema (read-only)
  page(
    title: string,
    configFn: (context: StepContext<TState, TOptions> & TPlugins) => {
      message: TemplateReturn;
      inputData: unknown;
      system?: TemplateReturn;
      onCreated?: (page: GeneratedPage) => void | Promise<void>;
      slug?: string;
      ttl?: number;
      persist?: boolean;
    }
  ): Brain<TOptions, TState, TPlugins>;

  // Overload 3: Custom HTML with outputSchema
  page<
    TOutputSchema extends z.ZodObject<any>,
    TNewState extends State = TState & z.infer<TOutputSchema>
  >(
    title: string,
    configFn: (context: StepContext<TState, TOptions> & TPlugins) => {
      html: TemplateChild;
      outputSchema: TOutputSchema;
      onCreated?: (page: GeneratedPage<TOutputSchema>) => void | Promise<void>;
      ttl?: number;
      persist?: boolean;
    }
  ): Brain<TOptions, TNewState, TPlugins>;

  // Overload 4: Custom HTML without outputSchema
  page(
    title: string,
    configFn: (context: StepContext<TState, TOptions> & TPlugins) => {
      html: TemplateChild;
      onCreated?: (page: GeneratedPage) => void | Promise<void>;
      ttl?: number;
      persist?: boolean;
    }
  ): Brain<TOptions, TState, TPlugins>;

  // Implementation
  page(
    title: string,
    configFn: (context: any) => PageConfig | Promise<PageConfig>
  ): any {
    const pageBlock: StepBlock<TState, TState, TOptions, TPlugins, any, any> = {
      type: 'step',
      title,
      isPageStep: true,
      pageConfigFn: configFn,
      action: async () => {
        throw new Error(
          `Page step "${title}" - page generation is handled by the runner, not the step action directly.`
        );
      },
    };
    this.blocks.push(pageBlock);
    return this.nextBrain<any>();
  }

  // Overload signatures
  run(params: InitialRunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;
  run(params: ResumeRunParams<TOptions>): AsyncGenerator<BrainEvent<TOptions>>;

  // Implementation signature
  async *run(
    params: InitialRunParams<TOptions> | ResumeRunParams<TOptions>
  ): AsyncGenerator<BrainEvent<TOptions>> {
    const { title, description, blocks } = this;
    const brainRunId =
      'resume' in params && params.resume
        ? params.brainRunId
        : (params as InitialRunParams<TOptions>).brainRunId ?? '';

    // Platform services
    const files = params.files;
    const pages = params.pages;
    const store =
      this.storeSchema && params.storeProvider
        ? params.storeProvider({
            brainTitle: title,
            currentUser: params.currentUser,
            schema: this.storeSchema,
          })
        : undefined;

    const {
      injections: pluginInjections,
      adapters: pluginAdapters,
      configs: mergedPluginConfigs,
    } = resolvePlugins(params.pluginConfigs ?? [], this.pluginConfigs, {
      brainTitle: title,
      currentUser: params.currentUser,
      brainRunId,
    });

    const stream = new BrainEventStream({
      title,
      description,
      blocks,
      ...params,
      options: (params.options || {}) as TOptions,
      optionsSchema: this.optionsSchema,
      brainClient: this.brainClient,
      files,
      pages,
      store,
      pluginInjections,
      pluginAdapters,
      pluginConfigs: mergedPluginConfigs,
    });

    yield* stream.next();
  }

  private withBlocks(
    blocks: Block<any, any, TOptions, TPlugins, any, any>[]
  ): this {
    this.blocks = blocks;
    return this;
  }

  private copyConfigTo(target: Brain<any, any, any>): void {
    target.optionsSchema = this.optionsSchema;
    target.storeSchema = this.storeSchema;
    target.pluginConfigs = this.pluginConfigs;
    target.brainClient = this.brainClient;
  }

  private nextBrain<TNewState extends State>(): Brain<
    TOptions,
    TNewState,
    TPlugins
  > {
    const nextBrain = new Brain<TOptions, TNewState, TPlugins>(
      this.title,
      this.description
    ).withBlocks(this.blocks as any);
    this.copyConfigTo(nextBrain);
    return nextBrain;
  }

  private continuationCallbacks<TResponse>(): Continuation<
    TOptions,
    TState,
    TPlugins,
    TResponse
  > {
    const blocks = this.blocks;
    const self = this;
    return new Continuation<TOptions, TState, TPlugins, TResponse>(
      (block) => blocks.push(block),
      <TNewState extends State>() => {
        const next = new Brain<TOptions, TNewState, TPlugins>(
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
  TState extends State = object
>(title: string): Brain<TOptions, TState, object>;

// Overload 2: Config object with optional plugins
export function brain<
  TOptions extends JsonObject = JsonObject,
  TState extends State = object,
  TPluginMap extends Record<string, ConfiguredPlugin> = {}
>(config: {
  title: string;
  description?: string;
  client?: ObjectGenerator;
  plugins?: TPluginMap;
}): Brain<TOptions, TState, PluginsFrom<TPluginMap>>;

// Implementation
export function brain(
  titleOrConfig:
    | string
    | {
        title: string;
        description?: string;
        client?: ObjectGenerator;
        plugins?: Record<string, ConfiguredPlugin>;
      }
): Brain<any, any, any> {
  const isString = typeof titleOrConfig === 'string';
  const title = isString ? titleOrConfig : titleOrConfig.title;
  const description = isString ? undefined : titleOrConfig.description;
  const client = isString ? undefined : titleOrConfig.client;
  const plugins = isString ? undefined : titleOrConfig.plugins;

  registerBrainName(title);

  let newBrain = new Brain<any, any, any>(title, description, client);

  if (plugins) {
    for (const plugin of Object.values(plugins)) {
      newBrain = newBrain.withPlugin(plugin);
    }
  }

  return newBrain;
}
