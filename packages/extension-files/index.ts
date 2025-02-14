import { type Workflow, createExtension } from "@positronic/core";
import type { State } from "@positronic/core";
const filesExtension = createExtension('fs', {
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
  },
  files(
    this: Workflow<any>,
    title: string,
    files: {
      [key: string]: string;
  }) {
    return this.step('files', ({ state }) => ({ ...state, files }));
  }
});

declare module "@positronic/core" {
  interface Workflow<TOptions extends object, TState extends State> {
    fs: ReturnType<typeof filesExtension.augment<TOptions, TState>>;
  }
}

filesExtension.install();