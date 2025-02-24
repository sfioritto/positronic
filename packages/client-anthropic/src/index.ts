import type { PromptClient, ResponseModel } from '@positronic/core';
import Instructor from '@instructor-ai/instructor';
import { createLLMClient } from "llm-polyglot"
import { z } from 'zod';
import { config} from 'dotenv';
import type { InstructorClient } from '@instructor-ai/instructor';

config();

const anthropic = createLLMClient({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    "anthropic-beta": "output-128k-2025-02-19",
  },
});

export class AnthropicClient implements PromptClient {
  private client: InstructorClient<typeof anthropic>;

  constructor() {
    this.client = Instructor({
      client: anthropic,
      mode: "TOOLS",
    });
  }

  async execute<T extends z.AnyZodObject>(
    prompt: string,
    responseModel: ResponseModel<T>,
  ): Promise<z.infer<T>> {
    const response = await this.client.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "claude-3-7-sonnet-latest",
      response_model: responseModel,
      max_tokens: 64000,
      extra_options: {
        thinking: {
          type: "enabled",
          budget_tokens: 64000
        }
      },
    })

    return response;
  }
}