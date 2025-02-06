import { Workflow } from "./blocks";
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

Workflow.prototype.fetch = function<
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
  return this.step(title, async (ctx: TContext) => {
    const url = typeof config.url === 'function' ? config.url(ctx) : config.url;
    const response = await fetch(url, { method: config.method || 'GET' });
    const rawData = await response.json();
    const data = config.schema.parse(rawData);

    return {
      ...ctx,
      ...data
    };
  });
};
