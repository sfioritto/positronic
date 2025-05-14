import type { ObjectGenerator, ResponseModel } from '@positronic/core';
import Instructor from '@instructor-ai/instructor';
import { createLLMClient } from 'llm-polyglot';
import { z } from 'zod';
import { config } from 'dotenv';
import type { InstructorClient } from '@instructor-ai/instructor';

config();

const anthropic = createLLMClient({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    'anthropic-beta': 'output-128k-2025-02-19',
  },
});

export class AnthropicClient implements ObjectGenerator {
  private client: InstructorClient<typeof anthropic>;

  constructor() {
    this.client = Instructor({
      client: anthropic,
      mode: 'TOOLS',
    });
  }

  async generateObject<T extends z.AnyZodObject>(params: {
    outputSchema: ResponseModel<T>;
    prompt?: string;
    messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
    system?: string;
    modelConfig?: {
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      [key: string]: any;
    };
  }): Promise<z.infer<T>> {
    // Compose messages array according to the interface contract
    let messages = params.messages ? [...params.messages] : [];
    if (params.system) {
      messages = [{ role: 'system', content: params.system }, ...messages];
    }
    if (params.prompt) {
      messages = [...messages, { role: 'user', content: params.prompt }];
    }
    // Use modelConfig or defaults
    const model = params.modelConfig?.modelId || 'claude-3-7-sonnet-latest';
    const max_tokens = params.modelConfig?.maxTokens || 64000;
    const temperature = params.modelConfig?.temperature;
    const top_p = params.modelConfig?.topP;
    const extra_options = {
      thinking: {
        type: 'enabled',
        budget_tokens: max_tokens,
      },
    };
    const response = await this.client.chat.completions.create({
      messages,
      model,
      response_model: params.outputSchema,
      max_tokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(top_p !== undefined ? { top_p } : {}),
      extra_options,
    });
    return response;
  }
}
