import { Workflow, type Expand, type Context } from "../dsl/blocks";
import { z } from "zod";

// Type augmentation - only available when this module is imported
declare module "../dsl/blocks" {
  export interface Workflow<TOptions, TContext> {
    fetch<TSchema extends z.ZodObject<any>>(
      title: string,
      config: {
        url: string | ((ctx: TContext) => string);
        method?: string;
        schema: TSchema;
      }
    ): Workflow<TOptions, Expand<TContext & z.infer<TSchema>>>;
  }
}

// Wrap the prototype modification in a function that runs after module initialization
(() => {
  Workflow.prototype.fetch = function(title, config) {
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
})();
