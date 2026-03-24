import type {
  PluginDefinition,
  PluginCreateReturn,
  ConfiguredPlugin,
  ConfiguredPluginWithSetup,
} from './types.js';

/**
 * Define a plugin with a setup function for typed configuration.
 * Returns a ConfiguredPlugin with a .setup() method.
 *
 * Usage:
 *   const mem0 = definePlugin({ name: 'mem0', setup: (c: Config) => c, create: ... })
 *   brain('x').withPlugin(mem0)                    // default config
 *   brain('x').withPlugin(mem0.setup({ scope: 'user' }))  // custom config
 */
export function definePlugin<
  TName extends string,
  TConfig,
  TCreate extends PluginCreateReturn
>(
  definition: PluginDefinition<TName, TConfig, TCreate> & {
    setup: (config: TConfig) => TConfig;
  }
): ConfiguredPluginWithSetup<TName, TConfig, TCreate>;

/**
 * Define a plugin without a setup function (no configuration needed).
 * Returns a ConfiguredPlugin that can be passed directly to withPlugin().
 *
 * Usage:
 *   const logger = definePlugin({ name: 'logger', create: ... })
 *   brain('x').withPlugin(logger)
 */
export function definePlugin<
  TName extends string,
  TCreate extends PluginCreateReturn
>(
  definition: PluginDefinition<TName, undefined, TCreate> & { setup?: never }
): ConfiguredPlugin<TName, undefined, TCreate>;

export function definePlugin(
  definition: PluginDefinition<string, any, PluginCreateReturn>
) {
  const plugin: ConfiguredPlugin & {
    setup?: (config: any) => ConfiguredPlugin;
  } = {
    __plugin: definition,
    __config: undefined,
  };

  if (definition.setup) {
    (
      plugin as ConfiguredPluginWithSetup<string, any, PluginCreateReturn>
    ).setup = (config: any) => ({
      __plugin: definition,
      __config: definition.setup!(config),
    });
  }

  return plugin;
}
