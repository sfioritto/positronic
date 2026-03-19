import { z } from 'zod';
import { brain as coreBrain, Brain } from './builder/brain.js';
import type {
  AgentConfig,
  AgentConfigWithOutput,
  AgentTool,
  StepContext,
  State,
  JsonObject,
} from './types.js';
import type { UIComponent } from '../ui/types.js';
import type { MemoryProvider, ScopedMemory } from '../memory/types.js';
import type { StoreSchema, InferStoreTypes, Store } from '../store/types.js';

/**
 * Configuration for creating a project-level brain function.
 */
export interface CreateBrainConfig<
  TServices extends object = {},
  TComponents extends Record<string, UIComponent<any>> = {},
  TTools extends Record<string, AgentTool<any>> = {},
  TStoreSchema extends StoreSchema | undefined = undefined,
  TMemory extends MemoryProvider | undefined = undefined
> {
  /** Services available to all brains (e.g., slack, gmail, database clients) */
  services?: TServices;
  /** UI components for generative UI steps */
  components?: TComponents;
  /** Default tools available to all agent steps */
  defaultTools?: TTools;
  /** Memory provider for long-term memory storage */
  memory?: TMemory;
  /** Store field definitions for typed key-value storage */
  store?: TStoreSchema;
}

/**
 * Creates a project-level brain function with pre-configured services, components, and tools.
 *
 * This is the recommended way to set up brains in a Positronic project. It provides:
 * - Type-safe access to services in all brain steps
 * - Automatic injection of components and default tools
 * - Support for both builder pattern and direct agent creation
 *
 * @example
 * ```typescript
 * // brain.ts - your project's brain configuration
 * import { createBrain } from '@positronic/core';
 * import { components } from './components/index.js';
 * import slack from './services/slack.js';
 * import gmail from './services/gmail.js';
 *
 * export const brain = createBrain({
 *   services: { slack, gmail },
 *   components,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // brains/my-brain.ts - using the configured brain
 * import { brain } from '../brain.js';
 *
 * // Builder pattern
 * export default brain('my-workflow')
 *   .step('Init', ({ slack }) => {
 *     slack.postMessage('#general', 'Starting workflow');
 *     return { started: true };
 *   });
 *
 * // Or direct agent creation
 * export default brain('my-agent', ({ slack, env }) => ({
 *   system: 'You are helpful',
 *   prompt: 'Help the user',
 *   tools: { ... }
 * }));
 * ```
 */
export function createBrain<
  TServices extends object = {},
  TComponents extends Record<string, UIComponent<any>> = {},
  TTools extends Record<string, AgentTool<any>> = {},
  TStoreSchema extends StoreSchema | undefined = undefined,
  TMemory extends MemoryProvider | undefined = undefined
>(
  config: CreateBrainConfig<
    TServices,
    TComponents,
    TTools,
    TStoreSchema,
    TMemory
  >
) {
  const { services, components, defaultTools, memory, store } = config;

  // Derive the store service type from the schema
  type StoreService = TStoreSchema extends StoreSchema
    ? { store: Store<InferStoreTypes<TStoreSchema>> }
    : {};

  // Derive the memory service type from the provider
  type MemoryService = TMemory extends MemoryProvider
    ? { memory: ScopedMemory }
    : {};

  // Combined services type
  type AllServices = TServices & StoreService & MemoryService;

  // The params available in agent config functions - uses StepContext for consistency
  type AgentParams = StepContext<object, {}> &
    AllServices & {
      tools: TTools extends {} ? Record<string, AgentTool<any>> : TTools;
    };

  // Overload 1: Direct agent with config object WITH outputSchema (required)
  function brain<
    T extends Record<string, AgentTool<any>>,
    TName extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = { [K in TName]: z.infer<TSchema> }
  >(
    title: string,
    config: AgentConfigWithOutput<T, TSchema, TName>
  ): Brain<{}, TNewState, AllServices>;

  // Overload 2: Direct agent with config function WITH outputSchema (required)
  function brain<
    T extends Record<string, AgentTool<any>>,
    TName extends string & { readonly brand?: unique symbol },
    TSchema extends z.ZodObject<any>,
    TNewState extends State = { [K in TName]: z.infer<TSchema> }
  >(
    title: string,
    configFn: (
      params: AgentParams
    ) =>
      | AgentConfigWithOutput<T, TSchema, TName>
      | Promise<AgentConfigWithOutput<T, TSchema, TName>>
  ): Brain<{}, TNewState, AllServices>;

  // Overload 3: Builder pattern with title string
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(title: string): Brain<TOptions, TState, AllServices>;

  // Overload 4: Builder pattern with config object
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(config: {
    title: string;
    description?: string;
  }): Brain<TOptions, TState, AllServices>;

  // Implementation
  function brain(
    titleOrConfig: string | { title: string; description?: string },
    agentConfig?:
      | AgentConfig<any>
      | ((params: AgentParams) => AgentConfig<any> | Promise<AgentConfig<any>>)
  ): any {
    let base = coreBrain(titleOrConfig as any);

    if (components) {
      base = base.withComponents(components) as any;
    }

    if (defaultTools) {
      base = base.withTools(defaultTools) as any;
    }

    if (memory) {
      base = base.withMemory(memory) as any;
    }

    if (store) {
      base = base.withStore(store) as any;
    }

    if (services) {
      base = base.withServices(services) as any;
    }

    if (agentConfig) {
      return base.brain('main', agentConfig as any) as any;
    }

    return base as any;
  }

  return brain;
}
