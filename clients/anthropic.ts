import type { PromptClient, ResponseModel } from '../types';
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
    "anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15",
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
      model: "claude-3-5-sonnet-20241022",
      response_model: responseModel,
      max_tokens: 8192,
    })

    return response;
  }
}