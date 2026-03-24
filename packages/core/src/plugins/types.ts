import type { CurrentUser } from '../dsl/types.js';
import type { Adapter } from '../adapters/types.js';

/**
 * Context passed to a plugin's `create` function.
 * Contains per-run information needed to scope the plugin instance.
 */
export interface CreateContext<TConfig = undefined> {
  config: TConfig;
  brainTitle: string;
  currentUser: CurrentUser;
  brainRunId: string;
}

/**
 * A plugin adapter that receives brain events.
 * Optional `resume` method receives historical events on brain resume
 * for rebuilding internal state without side effects.
 */
export interface PluginAdapter {
  dispatch(event: any): void | Promise<void>;
  resume?(events: any[]): void;
}

/**
 * The return value of a plugin's `create` function.
 * Special keys `tools` and `adapter` are intercepted by the framework.
 * Everything else goes on StepContext under the plugin name.
 */
export type PluginCreateReturn = {
  tools?: Record<string, any>;
  adapter?: PluginAdapter;
  [key: string]: any;
};

/**
 * The full plugin definition as passed to definePlugin().
 */
export interface PluginDefinition<
  TName extends string,
  TConfig,
  TCreate extends PluginCreateReturn
> {
  name: TName;
  setup?: (config: TConfig) => TConfig;
  create: (ctx: CreateContext<TConfig>) => TCreate;
}

/**
 * What goes on StepContext under the plugin name:
 * everything from create() except `adapter`.
 */
export type PluginInjection<TCreate extends PluginCreateReturn> = Omit<
  TCreate,
  'adapter'
>;

/**
 * A configured plugin instance. Returned by definePlugin() and by .setup().
 * Can be passed directly to brain.withPlugin().
 *
 * The __plugin and __config fields are internal — used by the framework
 * to resolve plugins at brain.run() time.
 */
export interface ConfiguredPlugin<
  TName extends string = string,
  TConfig = any,
  TCreate extends PluginCreateReturn = PluginCreateReturn
> {
  readonly __plugin: PluginDefinition<TName, TConfig, TCreate>;
  readonly __config: TConfig;
}

/**
 * Extract plugin injections from a plugins object literal.
 * Maps { slack: ConfiguredPlugin<'slack', C, R> } → { slack: PluginInjection<R> }.
 * The injection name comes from the object key, not the plugin's internal name.
 */
export type PluginsFrom<T extends Record<string, ConfiguredPlugin>> = {
  [K in keyof T]: T[K] extends ConfiguredPlugin<any, any, infer C>
    ? PluginInjection<C>
    : never;
};

/**
 * A configured plugin that also has a .setup() method for per-brain configuration.
 * Returned by definePlugin() when a setup function is provided.
 */
export interface ConfiguredPluginWithSetup<
  TName extends string,
  TConfig,
  TCreate extends PluginCreateReturn
> extends ConfiguredPlugin<TName, TConfig, TCreate> {
  setup(config: TConfig): ConfiguredPlugin<TName, TConfig, TCreate>;
}
