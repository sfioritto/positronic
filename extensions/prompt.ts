import { createExtension, type Context } from "../dsl/new-dsl";
import type { PromptClient } from "../types";
import { z } from "zod";
import { AnthropicClient } from "../clients/anthropic";

interface PromptConfig<TSchema extends z.ZodObject<any>> {
  template: (context: Context) => string;
  responseModel: {
    schema: TSchema;
    name: string;
  };
  client?: PromptClient;
}

export const promptExtension = createExtension({
  prompt: <
    TSchema extends z.ZodObject<any>
  >(
    title: string,
    config: PromptConfig<TSchema>
  ) => ({
    title,
    action: async ({ context }) => {
      const { template, responseModel, client: configClient } = config;
      const client = configClient ?? new AnthropicClient();
      const promptString = template(context);
      const result = await client.execute(promptString, responseModel);

      return {
        ...context,
        [responseModel.name]: result
      };
    }
  })
});