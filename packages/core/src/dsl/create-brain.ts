import { brain as coreBrain, Brain } from './builder/brain.js';
import type { ObjectGenerator } from '../clients/types.js';
import type { State, JsonObject } from './types.js';
import type { ConfiguredPlugin, PluginsFromArray } from '../plugins/types.js';

/**
 * Configuration for creating a project-level brain function.
 */
export interface CreateBrainConfig<
  TPlugins extends readonly ConfiguredPlugin[] = readonly ConfiguredPlugin[]
> {
  /** Plugins available to all brains */
  plugins?: TPlugins;
}

/**
 * Creates a project-level brain function with pre-configured plugins and components.
 *
 * Plugin types are inferred from the array and propagated to all brains
 * created by the returned factory function.
 *
 * @example
 * ```typescript
 * import { createBrain } from '@positronic/core';
 * import { mem0 } from '@positronic/mem0';
 * import { components } from './components/index.js';
 *
 * export const brain = createBrain({
 *   plugins: [mem0.setup({ provider })],
 *   components,
 * });
 * ```
 */
export function createBrain<
  const TPlugins extends readonly ConfiguredPlugin[] = readonly []
>(config: { plugins?: TPlugins }) {
  const { plugins } = config;

  // Overload 1: Builder pattern with title string
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(title: string): Brain<TOptions, TState, PluginsFromArray<TPlugins>>;

  // Overload 2: Builder pattern with config object
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(config: {
    title: string;
    description?: string;
    client?: ObjectGenerator;
  }): Brain<TOptions, TState, PluginsFromArray<TPlugins>>;

  // Implementation
  function brain(
    titleOrConfig:
      | string
      | { title: string; description?: string; client?: ObjectGenerator }
  ): any {
    let base = coreBrain(titleOrConfig as any);

    if (plugins) {
      for (const plugin of plugins) {
        base = base.withPlugin(plugin) as any;
      }
    }

    return base as any;
  }

  brain.plugins = (plugins ?? []) as readonly ConfiguredPlugin[];

  return brain;
}
