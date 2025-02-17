import { type Workflow, createExtension } from "@positronic/core";
import type { State } from "@positronic/core";
import { promises as fs } from 'fs';

const filesExtension = createExtension('fs', {
  file<TName extends string>(
    this: Workflow,
    name: TName,
    path: string
  ) {
    return this.step(`Adding ${name}`, async ({ state }) => {
      const content = await fs.readFile(path, 'utf-8');
      return {
        ...state,
        files: {
          ...((state as any).files || {}),
          [name]: content
        }
      };
    });
  },
  files<TFiles extends Record<string, string>>(
    this: Workflow,
    title: string,
    files: Record<string, string>
  ) {
    return this.step(title, async ({ state }) => {
      const contents: Record<string, string> = {};
      for (const [name, path] of Object.entries(files)) {
        contents[name] = await fs.readFile(path, 'utf-8');
      }
      return {
        ...state,
        files: {
          ...((state as any).files || {}),
          ...contents
        }
      };
    });
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