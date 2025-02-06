import { Workflow } from "./blocks";
import type { Context, Flatten } from "./new-dsl";

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

declare module "./blocks" {
  interface Workflow<TContext> {
    fetch<TResponseKey extends string>(
      title: string,
      config: {
        url: string | ((ctx: TContext) => string);
        method?: string;
        responseKey: TResponseKey;
      }
    ): Workflow<Expand<TContext & { [K in TResponseKey]: Context }>>;
  }
}

Workflow.prototype.fetch = function <
  TContext extends Context,
  TResponseKey extends string
>(
  this: Workflow<TContext>,
  title: string,
  config: {
    url: string | ((ctx: TContext) => string);
    method?: string;
    responseKey: TResponseKey;
  }
) {
  return this.step(title, async (ctx: TContext) => {
    const url = typeof config.url === 'function' ? config.url(ctx) : config.url;
    const response = await fetch(url, { method: config.method || 'GET' });
    const data = await response.json();

    // Use Merge<> here to flatten the intersection type
    return {
      ...ctx,
      [config.responseKey]: data
    };
  });
};
