import type { ObjectGenerator, OutputSchema, Message } from '@positronic/core';
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const defaultOpenAIModel = openaiProvider('gpt-4o');

export class VercelClient implements ObjectGenerator {
  async generateObject<T extends z.AnyZodObject>(params: {
    outputSchema: OutputSchema<T>;
    prompt?: string;
    messages?: Message[];
    system?: string;
    modelConfig?: {
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      mode?: 'auto' | 'tool' | 'json';
      [key: string]: any;
    };
  }): Promise<z.infer<T>> {
    const { outputSchema, prompt, messages, system, modelConfig } = params;

    const coreMessages: Message[] = [];

    if (system) {
      coreMessages.push({ role: 'system', content: system });
    }

    if (messages) {
      messages.forEach((msg) => {
        coreMessages.push({ role: msg.role, content: msg.content });
      });
    }

    if (prompt) {
      coreMessages.push({ role: 'user', content: prompt });
    }

    const modelInstance = modelConfig?.modelId
      ? openaiProvider(modelConfig.modelId as any) // Use the provider to get the model
      : defaultOpenAIModel; // Fallback to the default configured model

    // Remove apiKey and modelId from modelConfig before spreading, if they exist,
    // as they are handled separately or not applicable here.
    const { modelId, apiKey, ...restOfModelConfig } = modelConfig || {};

    const { object } = await generateObject({
      model: modelInstance,
      schema: outputSchema.schema,
      messages: coreMessages.length > 0 ? coreMessages : undefined,
      prompt: coreMessages.length === 0 && prompt ? prompt : undefined,
      mode: modelConfig?.mode || 'auto',
      schemaName: outputSchema.name,
      schemaDescription: outputSchema.description,
      ...restOfModelConfig, // Spread remaining modelConfig options
    });

    return object as z.infer<T>;
  }
}
