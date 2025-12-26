import type { ObjectGenerator, ToolMessage } from '@positronic/core';
import Instructor from '@instructor-ai/instructor';
import { createLLMClient } from 'llm-polyglot';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
  private anthropicSdk: Anthropic;

  constructor() {
    this.client = Instructor({
      client: anthropic,
      mode: 'TOOLS',
    });
    this.anthropicSdk = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generateObject<T extends z.AnyZodObject>(params: {
    schema: T;
    schemaName: string;
    schemaDescription?: string;
    prompt?: string;
    messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
    system?: string;
  }): Promise<z.infer<T>> {
    // Compose messages array according to the interface contract
    let messages = params.messages ? [...params.messages] : [];
    if (params.system) {
      messages = [{ role: 'system', content: params.system }, ...messages];
    }
    if (params.prompt) {
      messages = [...messages, { role: 'user', content: params.prompt }];
    }

    const model = 'claude-3-7-sonnet-latest';
    const max_tokens = 64000;
    const temperature = 0.5;
    const top_p = 1;
    const extra_options = {
      thinking: {
        type: 'enabled',
        budget_tokens: max_tokens,
      },
    };
    const response = await this.client.chat.completions.create({
      messages,
      model,
      response_model: {
        schema: params.schema,
        name: params.schemaName,
        description: params.schemaDescription,
      },
      max_tokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(top_p !== undefined ? { top_p } : {}),
      extra_options,
    });
    return response;
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

    // Convert ToolMessage[] to Anthropic message format
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        // Check if the last message is also assistant - need to merge content blocks
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          // Merge text content into existing assistant message
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = [
              { type: 'text', text: lastMsg.content },
              { type: 'text', text: msg.content },
            ];
          } else if (Array.isArray(lastMsg.content)) {
            lastMsg.content.push({ type: 'text', text: msg.content });
          }
        } else {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        // Tool results need to follow an assistant message with tool_use
        // Find or create the assistant message that had the tool call
        const lastAssistant = anthropicMessages[anthropicMessages.length - 1];
        if (lastAssistant && lastAssistant.role === 'assistant') {
          // Add tool_use block to assistant message if not present
          if (typeof lastAssistant.content === 'string') {
            lastAssistant.content = [
              { type: 'text', text: lastAssistant.content },
              { type: 'tool_use', id: msg.toolCallId!, name: msg.toolName!, input: {} },
            ];
          } else if (Array.isArray(lastAssistant.content)) {
            // Check if tool_use already exists
            const hasToolUse = lastAssistant.content.some(
              (block) => block.type === 'tool_use' && block.id === msg.toolCallId
            );
            if (!hasToolUse) {
              lastAssistant.content.push({
                type: 'tool_use',
                id: msg.toolCallId!,
                name: msg.toolName!,
                input: {},
              });
            }
          }
        }

        // Add user message with tool_result
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId!,
              content: msg.content,
            },
          ],
        });
      }
    }

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = Object.entries(tools).map(
      ([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: zodToJsonSchema(tool.inputSchema) as Anthropic.Tool.InputSchema,
      })
    );

    const response = await this.anthropicSdk.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: system,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    // Extract text and tool calls from response
    let text: string | undefined;
    const toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text = (text || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          toolCallId: block.id,
          toolName: block.name,
          args: block.input,
        });
      }
    }

    return {
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }
}
