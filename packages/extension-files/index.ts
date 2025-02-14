import { type Workflow, createExtension } from "@positronic/core";
import type { State } from "@positronic/core";

const filesExtension = createExtension('fs', {
  file<TName extends string>(
    this: Workflow<any>,
    name: TName,
    path: string
  ) {
    return this.step(`Adding ${name}`, async ({ state }) => {
      return {
        ...state,
        files: {
          ...((state as any).files || {}),
          [name]: path
        }
      };
    });
  },
  files<TFiles extends Record<string, string>>(
    this: Workflow<any>,
    title: string,
    files: TFiles
  ) {
    return this.step(title, ({ state }) => ({
      ...state,
      files,
    }));
  }
});

declare module "@positronic/core" {
  interface Workflow<TOptions extends object, TState extends State> {
    fs: {
      file<TName extends string>(
        name: TName,
        path: string
      ): Workflow<TOptions, TState & { files: { [K in TName]: string } }>;
      files<TFiles extends Record<string, string>>(
        title: string,
        files: TFiles
      ): Workflow<TOptions, TState & { files: TFiles }>;
    };
  }
}

filesExtension.install();