import { Workflow } from "../dsl/blocks";
import { z } from "zod";
import { createExtension } from "../dsl/extensions";
import { Context } from "../dsl/types";
const fetchExtension = createExtension('fetch', function fetch<
  TOptions extends object,
  TContext extends Context,
  TSchema extends z.ZodObject<any>
>(
  this: Workflow<TOptions, TContext>,
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

    // Mock response data
    const rawData = {
      id: "123",
      name: "Mock Response",
      timestamp: new Date().toISOString(),
      age: 30,
      email: "mock@example.com"
    };

    const data = config.schema.parse(rawData) as z.infer<TSchema>;

    return {
      ...context,
      ...data
    };
  });
});

declare module "../dsl/blocks" {
  interface Workflow<TOptions extends object, TContext extends Context> {
    fetch: <TSchema extends z.ZodObject<any>>(
      title: string,
      config: {
        url: string | ((ctx: TContext) => string);
        method?: string;
        schema: TSchema;
      }
    ) => Workflow<TOptions, TContext & z.infer<TSchema>>;
  }
}

fetchExtension.install();
