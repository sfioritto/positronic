import { Workflow, WorkflowExtension } from "./blocks";
import type { Context } from "./new-dsl";
import { z } from "zod";

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

declare module "./blocks" {
  interface Workflow<TContext> {
    fetch<TSchema extends z.ZodObject<any>>(
      title: string,
      config: {
        url: string | ((ctx: TContext) => string);
        method?: string;
        schema: TSchema;
      }
    ): Workflow<Expand<TContext & z.infer<TSchema>>>;
  }
}

export const fetchExtension: WorkflowExtension = (workflow) => {
  workflow.fetch = function<
    TContext extends Context,
    TSchema extends z.ZodObject<any>
  >(
    title: string,
    config: {
      url: string | ((ctx: TContext) => string);
      method?: string;
      schema: TSchema;
    }
  ) {
    return this.step(title, async ({ context }) => {
      const url = typeof config.url === 'function' ? config.url(context) : config.url;

      // Simulate network delay with setTimeout
      await new Promise(resolve => setTimeout(resolve, 500));

      // Mock response data with required age and email fields
      const rawData = {
        id: "123",
        name: "Mock Response",
        timestamp: new Date().toISOString(),
        age: 30,
        email: "mock@example.com"
      };

      const data = config.schema.parse(rawData);

      return {
        ...context,
        ...data
      };
    });
  };
};
