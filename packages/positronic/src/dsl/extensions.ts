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
      Object.defineProperty(Workflow.prototype, key, {
        get() {
          const boundMethods: Record<string, Function> = {};
          for (const [methodKey, fn] of Object.entries(extension)) {
            boundMethods[methodKey] = fn.bind(this);
          }
          return boundMethods;
        }
      });
    },
  };
}