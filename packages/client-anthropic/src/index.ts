import type { ObjectGenerator, ToolMessage, ResponseMessage, ToolChoice } from '@positronic/core';
import Instructor from '@instructor-ai/instructor';
import { createLLMClient } from 'llm-polyglot';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from 'dotenv';
import type { InstructorClient } from '@instructor-ai/instructor';

config();

/**
 * Convert our ToolChoice type to Anthropic's tool_choice format.
 */
function toAnthropicToolChoice(choice: ToolChoice): Anthropic.MessageCreateParams['tool_choice'] {
  switch (choice) {
    case 'required':
      return { type: 'any' };
    case 'none':
      return { type: 'none' } as Anthropic.MessageCreateParams['tool_choice'];
    case 'auto':
    default:
      return { type: 'auto' };
  }
}

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

  createToolResultMessage(
    toolCallId: string,
    toolName: string,
    result: unknown
  ): ResponseMessage {
    // Anthropic uses a "user" message with tool_result content blocks
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        },
      ],
    } as ResponseMessage;
  }

  async generateObject<T extends z.AnyZodObject>(params: {
    schema: T;
    schemaName: string;
    schemaDescription?: string;
    prompt?: string;
    messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
    system?: string;
    maxRetries?: number;
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
      ...(params.maxRetries !== undefined && { max_retries: params.maxRetries }),
    });
    return response;
  }

  async generateText(params: {
    system?: string;
    messages: ToolMessage[];
    responseMessages?: ResponseMessage[];
    tools: Record<string, { description: string; inputSchema: z.ZodSchema }>;
    toolChoice?: ToolChoice;
  }): Promise<{
    text?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
    usage: { totalTokens: number };
    responseMessages: ResponseMessage[];
  }> {
    const { system, messages, responseMessages, tools, toolChoice = 'required' } = params;

    // Build the messages to send
    let anthropicMessages: Anthropic.MessageParam[];

    if (responseMessages && responseMessages.length > 0) {
      // Use the native Anthropic messages directly (preserves conversation state)
      anthropicMessages = responseMessages as Anthropic.MessageParam[];
    } else {
      // First call - convert our ToolMessage format to Anthropic format
      anthropicMessages = [];

      for (const msg of messages) {
        if (msg.role === 'user') {
          anthropicMessages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          const contentBlocks: Anthropic.ContentBlockParam[] = [];

          if (msg.content) {
            contentBlocks.push({ type: 'text', text: msg.content });
          }

          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              contentBlocks.push({
                type: 'tool_use',
                id: tc.toolCallId,
                name: tc.toolName,
                input: tc.args as Record<string, unknown>,
              });
            }
          }

          if (contentBlocks.length > 0) {
            anthropicMessages.push({ role: 'assistant', content: contentBlocks });
          }
        } else if (msg.role === 'tool') {
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
      tool_choice: toAnthropicToolChoice(toolChoice),
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

    // Build assistant message from response for the conversation history
    const assistantMessage: Anthropic.MessageParam = {
      role: 'assistant',
      content: response.content,
    };

    // Return updated conversation (input messages + new assistant response)
    const updatedMessages = [...anthropicMessages, assistantMessage];

    return {
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      responseMessages: updatedMessages as ResponseMessage[],
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
    toolChoice?: ToolChoice;
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
    const { system, prompt, messages = [], tools, maxSteps = 10, toolChoice = 'required' } = params;

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = Object.entries(tools).map(
      ([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: zodToJsonSchema(tool.inputSchema) as Anthropic.Tool.InputSchema,
      })
    );

    // Build initial messages
    const anthropicMessages: Anthropic.MessageParam[] = [];

    // Add context messages
    for (const msg of messages) {
      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        anthropicMessages.push({ role: 'assistant', content: msg.content });
      }
    }

    // Add the initial prompt
    anthropicMessages.push({ role: 'user', content: prompt });

    // Collect all tool calls with results across steps
    const allToolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }> = [];

    let totalTokens = 0;
    let finalText: string | undefined;
    let step = 0;

    while (step < maxSteps) {
      step++;

      const response = await this.anthropicSdk.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: system,
        messages: anthropicMessages,
        tools: anthropicTools,
        tool_choice: toAnthropicToolChoice(toolChoice),
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      // Extract text and tool calls from response
      let stepText: string | undefined;
      const stepToolCalls: Array<{ id: string; name: string; input: unknown }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          stepText = (stepText || '') + block.text;
        } else if (block.type === 'tool_use') {
          stepToolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }

      finalText = stepText;

      // If no tool calls, we're done
      if (stepToolCalls.length === 0) {
        break;
      }

      // Add assistant message with tool calls
      anthropicMessages.push({
        role: 'assistant',
        content: response.content,
      });

      // Execute tools and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of stepToolCalls) {
        const tool = tools[toolCall.name];
        let result: unknown;

        if (tool?.execute) {
          result = await tool.execute(toolCall.input);
        } else {
          result = { success: true };
        }

        allToolCalls.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.input,
          result,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      // Add user message with tool results
      anthropicMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    return {
      toolCalls: allToolCalls,
      text: finalText,
      usage: { totalTokens },
    };
  }
}
