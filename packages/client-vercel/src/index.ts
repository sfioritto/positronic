import type { ObjectGenerator, Message, ToolMessage } from '@positronic/core';
import {
  generateObject,
  generateText,
  streamText as vercelStreamText,
  stepCountIs,
} from 'ai';
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
        // Build content array for assistant message
        const contentParts: Array<
          | { type: 'text'; text: string }
          | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
        > = [];

        // Add text if present
        if (msg.content) {
          contentParts.push({ type: 'text', text: msg.content });
        }

        // Add tool calls if present (using 'input' as Vercel SDK expects)
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            contentParts.push({
              type: 'tool-call',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.args,
            });
          }
        }

        // Push message with content array or string
        if (contentParts.length > 0) {
          modelMessages.push({ role: 'assistant', content: contentParts });
        }
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

  async streamText(params: {
    system?: string;
    prompt: string;
    messages?: ToolMessage[];
    tools: Record<
      string,
      {
        description: string;
        inputSchema: z.ZodSchema;
        execute?: (args: unknown) => Promise<unknown> | unknown;
      }
    >;
    maxSteps?: number;
  }): Promise<{
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }>;
    text?: string;
    usage: { totalTokens: number };
  }> {
    const { system, prompt, messages, tools, maxSteps = 10 } = params;

    // Build messages array
    const modelMessages: ModelMessage[] = [];

    if (system) {
      modelMessages.push({ role: 'system', content: system });
    }

    // Add any context messages
    if (messages) {
      for (const msg of messages) {
        if (msg.role === 'user') {
          modelMessages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          // Build content array for assistant message
          const contentParts: Array<
            | { type: 'text'; text: string }
            | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
          > = [];

          // Add text if present
          if (msg.content) {
            contentParts.push({ type: 'text', text: msg.content });
          }

          // Add tool calls if present (using 'input' as Vercel SDK expects)
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              contentParts.push({
                type: 'tool-call',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.args,
              });
            }
          }

          // Push message with content array or string
          if (contentParts.length > 0) {
            modelMessages.push({ role: 'assistant', content: contentParts });
          }
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
    }

    // Add the initial prompt
    modelMessages.push({ role: 'user', content: prompt });

    // Convert tools to Vercel AI SDK format (with execute functions)
    const aiTools: Record<
      string,
      {
        description: string;
        inputSchema: z.ZodSchema;
        execute?: (args: unknown) => Promise<unknown> | unknown;
      }
    > = {};
    for (const [name, tool] of Object.entries(tools)) {
      aiTools[name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: tool.execute,
      };
    }

    // Call Vercel's streamText with multi-step support
    const stream = vercelStreamText({
      model: this.model,
      messages: modelMessages,
      tools: aiTools,
      stopWhen: stepCountIs(maxSteps),
    });

    // Await the steps and text (automatically consumes the stream)
    const [steps, text, usage] = await Promise.all([
      stream.steps,
      stream.text,
      stream.totalUsage,
    ]);

    // Collect all tool calls across all steps with their results
    const allToolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }> = [];

    for (const step of steps) {
      // Match tool calls with their results
      for (const toolCall of step.toolCalls) {
        const toolResult = step.toolResults.find(
          (tr) => tr.toolCallId === toolCall.toolCallId
        );
        allToolCalls.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.input,
          result: toolResult?.output,
        });
      }
    }

    return {
      toolCalls: allToolCalls,
      text: text || undefined,
      usage: {
        totalTokens: usage?.totalTokens ?? 0,
      },
    };
  }
}
