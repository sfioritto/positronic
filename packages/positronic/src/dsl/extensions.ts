import { Workflow } from "./workflow";
import type { State } from "./types";

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

type ExtensionMethods<
  TExtension extends Record<string, any>,
  TOptions extends object,
  TState extends State
> = TExtension extends ((...args: any[]) => any)
  ? TExtension extends ((
      this: any,
      title: string,
      config: infer TConfig
    ) => Workflow<any, infer TReturnState>)
    ? (
        title: string,
        config: TConfig extends ((ctx: any) => any)
          ? { [P in keyof TConfig]: TConfig[P] extends Function ? ((ctx: TState) => any) : TConfig[P] }
          : TConfig
      ) => Workflow<TOptions, Expand<TState & TReturnState>>
    : never
  : {
      [K in keyof TExtension]: TExtension[K] extends (
        this: any,
        title: string,
        config: infer TConfig
      ) => Workflow<any, infer TReturnState>
        ? (
            title: string,
            config: TConfig extends ((ctx: any) => any)
              ? { [P in keyof TConfig]: TConfig[P] extends Function ? ((ctx: TState) => any) : TConfig[P] }
              : TConfig
          ) => Workflow<TOptions, Expand<TState & TReturnState>>
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
    augment<TOptions extends object, TState extends State>(): ExtensionMethods<TExtension, TOptions, TState> {
      return {} as ExtensionMethods<TExtension, TOptions, TState>;
    }
  };
}