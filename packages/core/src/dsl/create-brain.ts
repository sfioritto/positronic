import { brain as coreBrain, Brain } from './builder/brain.js';
import type { State, JsonObject } from './types.js';
import type { UIComponent } from '../ui/types.js';
import type { MemoryProvider, ScopedMemory } from '../memory/types.js';
import type { StoreSchema, InferStoreTypes, Store } from '../store/types.js';

/**
 * Configuration for creating a project-level brain function.
 */
export interface CreateBrainConfig<
  TServices extends object = {},
  TComponents extends Record<string, UIComponent<any>> = {},
  TStoreSchema extends StoreSchema | undefined = undefined,
  TMemory extends MemoryProvider | undefined = undefined
> {
  /** Services available to all brains (e.g., slack, gmail, database clients) */
  services?: TServices;
  /** UI components for generative UI steps */
  components?: TComponents;
  /** Memory provider for long-term memory storage */
  memory?: TMemory;
  /** Store field definitions for typed key-value storage */
  store?: TStoreSchema;
}

/**
 * Creates a project-level brain function with pre-configured services and components.
 *
 * This is the recommended way to set up brains in a Positronic project. It provides:
 * - Type-safe access to services in all brain steps
 * - Automatic injection of components
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
 * export default brain('my-workflow')
 *   .step('Init', ({ slack }) => {
 *     slack.postMessage('#general', 'Starting workflow');
 *     return { started: true };
 *   });
 * ```
 */
export function createBrain<
  TServices extends object = {},
  TComponents extends Record<string, UIComponent<any>> = {},
  TStoreSchema extends StoreSchema | undefined = undefined,
  TMemory extends MemoryProvider | undefined = undefined
>(config: CreateBrainConfig<TServices, TComponents, TStoreSchema, TMemory>) {
  const { services, components, memory, store } = config;

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

  // Overload 1: Builder pattern with title string
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(title: string): Brain<TOptions, TState, AllServices>;

  // Overload 2: Builder pattern with config object
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(config: {
    title: string;
    description?: string;
  }): Brain<TOptions, TState, AllServices>;

  // Implementation
  function brain(
    titleOrConfig: string | { title: string; description?: string }
  ): any {
    let base = coreBrain(titleOrConfig as any);

    if (components) {
      base = base.withComponents(components) as any;
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

    return base as any;
  }

  return brain;
}
