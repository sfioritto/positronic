import { brain as coreBrain, Brain } from './builder/brain.js';
import type { State, JsonObject } from './types.js';
import type { UIComponent } from '../ui/types.js';

/**
 * Configuration for creating a project-level brain function.
 */
export interface CreateBrainConfig<
  TServices extends object = {},
  TComponents extends Record<string, UIComponent<any>> = {}
> {
  /** Services available to all brains (e.g., slack, gmail, database clients) */
  services?: TServices;
  /** UI components for generative UI steps */
  components?: TComponents;
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
  TComponents extends Record<string, UIComponent<any>> = {}
>(config: CreateBrainConfig<TServices, TComponents>) {
  const { services, components } = config;

  // Overload 1: Builder pattern with title string
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(title: string): Brain<TOptions, TState, TServices>;

  // Overload 2: Builder pattern with config object
  function brain<
    TOptions extends JsonObject = {},
    TState extends State = object
  >(config: {
    title: string;
    description?: string;
  }): Brain<TOptions, TState, TServices>;

  // Implementation
  function brain(
    titleOrConfig: string | { title: string; description?: string }
  ): any {
    let base = coreBrain(titleOrConfig as any);

    if (components) {
      base = base.withComponents(components) as any;
    }

    if (services) {
      base = base.withServices(services) as any;
    }

    return base as any;
  }

  return brain;
}
