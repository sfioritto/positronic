import type { ObjectGenerator, Message, ToolMessage } from '@positronic/core';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { LanguageModel, ModelMessage } from 'ai';

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

  async generateText(params: {
    system?: string;
    messages: ToolMessage[];
    tools: Record<string, { description: string; inputSchema: z.ZodSchema }>;
  }): Promise<{
    text?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
    usage: { totalTokens: number };
  }> {
    const { system, messages, tools } = params;

    // Convert ToolMessage[] to ModelMessage[]
    const modelMessages: ModelMessage[] = [];

    if (system) {
      modelMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        modelMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        modelMessages.push({ role: 'assistant', content: msg.content });
      } else if (msg.role === 'tool') {
        modelMessages.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.toolCallId!,
              toolName: msg.toolName!,
              output: { type: 'text', value: msg.content },
            },
          ],
        });
      }
    }

    // Convert our tool format to Vercel AI SDK format
    const aiTools: Record<
      string,
      { description: string; inputSchema: z.ZodSchema }
    > = {};
    for (const [name, tool] of Object.entries(tools)) {
      aiTools[name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    }

    // AI SDK 5 runs a single step by default (no stopWhen = single step)
    const result = await generateText({
      model: this.model,
      messages: modelMessages,
      tools: aiTools,
    });

    return {
      text: result.text || undefined,
      toolCalls: result.toolCalls?.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.input,
      })),
      usage: {
        totalTokens: result.usage?.totalTokens ?? 0,
      },
    };
  }
}
