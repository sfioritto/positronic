import { type Workflow, createExtension } from "@positronic/core";
import type { State } from "@positronic/core";
const filesExtension = createExtension('files', {
  file(
    this: Workflow<any>,
    title: string,
    config: {
      path: string;
    }
  ) {
    return this.step(title, async ({ state }) => {
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

declare module "@positronic/core" {
  interface Workflow<TOptions extends object, TState extends State> {
    files: ReturnType<typeof filesExtension.augment<TOptions, TState>>;
  }
}

filesExtension.install();