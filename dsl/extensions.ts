import { Workflow, type Expand, type Context } from "./blocks";

type ExtensionMethods<
  TExtension extends Record<string, any>,
  TOptions extends object,
  TContext extends Context
> = TExtension extends (<T>(...args: any[]) => any)
  ? TExtension extends (<T>(
      this: any,
      title: string,
      config: infer TConfig
    ) => Workflow<any, infer TReturnContext>)
    ? (
        title: string,
        config: TConfig extends ((ctx: any) => any)
          ? { [P in keyof TConfig]: TConfig[P] extends Function ? ((ctx: TContext) => any) : TConfig[P] }
          : TConfig
      ) => Workflow<TOptions, Expand<TContext & TReturnContext>>
    : never
  : {
      [K in keyof TExtension]: TExtension[K] extends (
        this: any,
        title: string,
        config: infer TConfig
      ) => Workflow<any, infer TReturnContext>
        ? (
            title: string,
            config: TConfig extends ((ctx: any) => any)
              ? { [P in keyof TConfig]: TConfig[P] extends Function ? ((ctx: TContext) => any) : TConfig[P] }
              : TConfig
          ) => Workflow<TOptions, Expand<TContext & TReturnContext>>
        : never;
    };

export function createExtension<
  TExtensionKey extends string,
  TExtension extends Record<string, any>
>(key: TExtensionKey, extension: TExtension) {
  return {
    install() {
      Object.assign(Workflow.prototype, {
        [key]: Object.fromEntries(
          Object.entries(extension).map(([methodKey, fn]) => [
            methodKey,
            fn.bind(Workflow.prototype)
          ])
        )
      });
    },
    augment<TOptions extends object, TContext extends Context>(): ExtensionMethods<TExtension, TOptions, TContext> {
      return {} as ExtensionMethods<TExtension, TOptions, TContext>;
    }
  };
}