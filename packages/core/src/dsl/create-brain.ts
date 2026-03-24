import { brain as coreBrain, Brain } from './builder/brain.js';
import type { State, JsonObject } from './types.js';
import type { UIComponent } from '../ui/types.js';
import type { ConfiguredPlugin } from '../plugins/types.js';

/**
 * Configuration for creating a project-level brain function.
 */
export interface CreateBrainConfig<
  TComponents extends Record<string, UIComponent<any>> = {}
> {
  /** Plugins available to all brains */
  plugins?: ConfiguredPlugin[];
  /** UI components for generative UI steps */
  components?: TComponents;
}

/**
 * Creates a project-level brain function with pre-configured plugins and components.
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
  TComponents extends Record<string, UIComponent<any>> = {}
>(config: CreateBrainConfig<TComponents>) {
  const { plugins, components } = config;

  // Overload 1: Builder pattern with title string
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(title: string): Brain<TOptions, TState, object>;

  // Overload 2: Builder pattern with config object
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(config: {
    title: string;
    description?: string;
  }): Brain<TOptions, TState, object>;

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

  return brain;
}
