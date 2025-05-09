import { Workflow } from './workflow.js';

export function createExtension<
  TExtensionKey extends string,
  TExtension extends Record<string, any>,
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
        },
      });
    },
  };
}
