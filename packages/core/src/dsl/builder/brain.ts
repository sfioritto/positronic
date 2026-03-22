import { z } from 'zod';
import type { ObjectGenerator } from '../../clients/types.js';
import type { IterateResult } from '../iterate-result.js';
import type { State, JsonObject, StepContext } from '../types.js';

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
  GuardBlock,
  WaitBlock,
  MapBlock,
  MapConfig,
  PageConfig,
  TemplateReturn,
} from '../definitions/blocks.js';
import type { GeneratedPage, BrainConfig } from '../definitions/brain-types.js';
import {
  resolveTemplate,
  buildTemplateContext,
} from '../../template/render.js';
import type { FileHandle } from '../../files/types.js';
import { guessMimeType } from '../../files/mime.js';
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
   * Configure UI components for page generation steps.
   *
   * @param components - Record of component definitions
   *
   * @example
   * ```typescript
   * import { components } from '@positronic/gen-ui-components';
   *
   * const myBrain = brain('my-brain')
   *   .withComponents(components)
   *   .page('Show Form', ({ state }) => ({ prompt: `Create a form for ${state.userName}` }));
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
   *   .step('Remember', async ({ memory }) => {
   *     const prefs = await memory.search('user preferences');
   *     return { preferences: prefs };
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
    predicate: (params: StepContext<TState, TOptions> & TServices) => boolean,
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
        | ((context: StepContext<TState, TOptions> & TServices) => State);
      options?:
        | TInnerOptions
        | ((
            context: StepContext<TState, TOptions> & TServices
          ) => TInnerOptions);
    }
  ): Brain<TOptions, TNewState, TServices> {
    const nestedConfig = config ?? {};
    const nestedBlock: BrainBlock<TState, any, any, TOptions, TServices> = {
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
    configFn: (context: StepContext<TState, TOptions> & TServices) =>
      | {
          message: TemplateReturn;
          outputSchema: TSchema;
          client?: ObjectGenerator;
          attachments?: FileHandle[];
        }
      | Promise<{
          message: TemplateReturn;
          outputSchema: TSchema;
          client?: ObjectGenerator;
          attachments?: FileHandle[];
        }>
  ): Brain<TOptions, TNewState, TServices> {
    const action = async (
      context: StepContext<TState, TOptions> & TServices
    ) => {
      const config = await configFn(context);
      const client = config.client ?? context.client;
      const prompt = await resolveTemplate(
        config.message,
        buildTemplateContext(context.files, context.resources)
      );
      const attachments = config.attachments
        ? await Promise.all(
            config.attachments.map(async (handle) => ({
              name: handle.name,
              mimeType: guessMimeType(handle.name),
              data: await handle.readBytes(),
            }))
          )
        : undefined;
      const result = await client.generateObject({
        schema: config.outputSchema,
        prompt,
        attachments,
      });
      return {
        ...context.state,
        ...result.object,
      };
    };
    const promptBlock: StepBlock<TState, any, TOptions, TServices, any, any> = {
      type: 'step',
      title,
      action: action as any,
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
    configFn: (context: StepContext<TState, TOptions> & TServices) => {
      run: Brain<TInnerOptions, TInnerState, any>;
      over: TItems | Promise<TItems>;
      initialState: (item: TItems[number]) => State;
      error?: (item: TItems[number], error: Error) => TInnerState | null;
      options?: TInnerOptions;
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
    stateKey: TStateKey & (string extends TStateKey ? never : unknown),
    configFn: (context: StepContext<TState, TOptions> & TServices) => {
      prompt: {
        message: (item: NoInfer<TItems[number]>) => TemplateReturn;
        outputSchema: TSchema;
      };
      client?: ObjectGenerator;
      over: TItems | Promise<TItems>;
      error?: (item: TItems[number], error: Error) => z.infer<TSchema> | null;
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Implementation
  map(
    title: string,
    stateKey: string,
    configFn: (context: any) => MapConfig | Promise<MapConfig>
  ): Brain<TOptions, any, TServices> {
    const mapBlock: MapBlock = {
      type: 'map',
      title,
      stateKey,
      configFn,
    };
    this.blocks.push(mapBlock);
    return this.nextBrain<any>();
  }

  // Overload 1: With formSchema - auto-merges response onto state
  page<
    TSchema extends z.ZodObject<any>,
    TNewState extends State = TState & z.infer<TSchema>
  >(
    title: string,
    configFn: (context: StepContext<TState, TOptions> & TServices) => {
      prompt: TemplateReturn;
      formSchema: TSchema;
      onCreated?: (page: GeneratedPage<TSchema>) => void | Promise<void>;
      props?: Record<string, unknown>;
      ttl?: number;
      persist?: boolean;
    }
  ): Brain<TOptions, TNewState, TServices>;

  // Overload 2: Without formSchema - returns Brain with unchanged state
  page(
    title: string,
    configFn: (context: StepContext<TState, TOptions> & TServices) => {
      prompt: TemplateReturn;
      onCreated?: (page: GeneratedPage) => void | Promise<void>;
      props?: Record<string, unknown>;
      ttl?: number;
      persist?: boolean;
    }
  ): Brain<TOptions, TState, TServices>;

  // Implementation
  page(
    title: string,
    configFn: (context: any) => PageConfig | Promise<PageConfig>
  ): any {
    const pageBlock: StepBlock<TState, TState, TOptions, TServices, any, any> =
      {
        type: 'step',
        title,
        isPageStep: true,
        pageConfigFn: configFn,
        action: async () => {
          throw new Error(
            `Page step "${title}" requires components to be configured via brain.withComponents(). ` +
              `Page generation is handled by the runner, not the step action directly.`
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

// Implementation
export function brain(
  titleOrConfig: string | BrainConfig
): Brain<any, any, any> {
  const title =
    typeof titleOrConfig === 'string' ? titleOrConfig : titleOrConfig.title;
  const description =
    typeof titleOrConfig === 'string' ? undefined : titleOrConfig.description;

  registerBrainName(title);

  return new Brain<any, any, any>(title, description);
}
