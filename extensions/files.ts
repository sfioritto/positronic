import { Workflow } from "../dsl/blocks";
import { createExtension } from "../dsl/extensions";
import type { Context } from "../dsl/types";
const filesExtension = createExtension('files', {
  file(
    this: Workflow<any>,
    title: string,
    config: {
      path: string;
    }
  ) {
    return this.step(title, async ({ context }) => {
      console.log(`[FILES] Creating file reference for ${config.path}`);

      return {
        ...context,
        files: {
          ...((context as any).files || {}),
          [title]: config.path
        }
      };
    });
  }
});

declare module "../dsl/blocks" {
  interface Workflow<TOptions extends object, TContext extends Context> {
    files: ReturnType<typeof filesExtension.augment<TOptions, TContext>>;
  }
}

filesExtension.install();