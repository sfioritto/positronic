import { brain as coreBrain, Brain } from './builder/brain.js';
import type { State, JsonObject } from './types.js';
import type { UIComponent } from '../ui/types.js';
import type { ConfiguredPlugin, PluginsFromArray } from '../plugins/types.js';

/**
 * Configuration for creating a project-level brain function.
 */
export interface CreateBrainConfig<
  TPlugins extends readonly ConfiguredPlugin[] = readonly ConfiguredPlugin[],
  TComponents extends Record<string, UIComponent<any>> = {}
> {
  /** Plugins available to all brains */
  plugins?: TPlugins;
  /** UI components for generative UI steps */
  components?: TComponents;
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
  const TPlugins extends readonly ConfiguredPlugin[] = readonly [],
  TComponents extends Record<string, UIComponent<any>> = {}
>(config: { plugins?: TPlugins; components?: TComponents }) {
  const { plugins, components } = config;

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
  }): Brain<TOptions, TState, PluginsFromArray<TPlugins>>;

  // Implementation
  function brain(
    titleOrConfig: string | { title: string; description?: string }
  ): any {
    let base = coreBrain(titleOrConfig as any);

    if (components) {
      base = base.withComponents(components) as any;
    }

    if (plugins) {
      for (const plugin of plugins) {
        base = base.withPlugin(plugin) as any;
      }
    }

    return base as any;
  }

  // Expose plugins array so the generated index.ts can collect plugin webhooks
  (brain as any).plugins = plugins ?? [];

  return brain;
}
