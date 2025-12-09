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

    // AI SDK v5 requires either messages or prompt, but not both as undefined
    // If we have messages built up, use them; otherwise use the prompt directly
    if (coreMessages.length > 0) {
      const { object } = await generateObject({
        model: this.model,
        schema,
        schemaName,
        schemaDescription,
        messages: coreMessages,
        mode: 'auto',
      });
      return object as z.infer<T>;
    } else {
      // Fallback to prompt-only mode (should rarely happen, but provides a default)
      const { object } = await generateObject({
        model: this.model,
        schema,
        schemaName,
        schemaDescription,
        prompt: prompt || '',
        mode: 'auto',
      });
      return object as z.infer<T>;
    }
  }
}
