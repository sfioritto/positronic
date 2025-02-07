import { Workflow } from "../dsl/blocks";
import { createExtension } from "../dsl/extensions";
import type { State } from "../dsl/types";
const filesExtension = createExtension('files', {
  file(
    this: Workflow<any>,
    title: string,
    config: {
      path: string;
    }
  ) {
    return this.step(title, async ({ state }) => {
      console.log(`[FILES] Creating file reference for ${config.path}`);

      return {
        ...state,
        files: {
          ...((state as any).files || {}),
          [title]: config.path
        }
      };
    });
  }
});

declare module "../dsl/blocks" {
  interface Workflow<TOptions extends object, TState extends State> {
    files: ReturnType<typeof filesExtension.augment<TOptions, TState>>;
  }
}

filesExtension.install();