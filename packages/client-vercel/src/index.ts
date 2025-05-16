import type { ObjectGenerator, Message } from '@positronic/core';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';

export class VercelClient implements ObjectGenerator {
  private model: LanguageModel;

  constructor(model: LanguageModel) {
    this.model = model;
  }

  async generateObject<T extends z.AnyZodObject>(params: {
    schema: T;
    schemaName: string;
    schemaDescription?: string;
    prompt?: string;
    messages?: Message[];
    system?: string;
  }): Promise<z.infer<T>> {
    const { schema, schemaName, schemaDescription, prompt, messages, system } =
      params;

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

    const { object } = await generateObject({
      model: this.model,
      schema,
      schemaName,
      schemaDescription,
      messages: coreMessages.length > 0 ? coreMessages : undefined,
      prompt: coreMessages.length === 0 && prompt ? prompt : undefined,
      mode: 'auto',
    });

    return object as z.infer<T>;
  }
}
