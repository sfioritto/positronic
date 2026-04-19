import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';
import { z } from 'zod';

const encoder = new Tiktoken(cl100k_base);

export function estimateTokens(text: string): number {
  return encoder.encode(text).length;
}

interface ToolDefinition {
  description: string;
  inputSchema: z.ZodSchema;
}

interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface ToolMessageLike {
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallInfo[];
}

export function estimateRequestTokens({
  prompt,
  messages,
  system,
  tools,
  schema,
}: {
  prompt?: string;
  messages?: Array<ToolMessageLike>;
  system?: string;
  tools?: Record<string, ToolDefinition>;
  schema?: z.ZodObject;
}): number {
  const parts: string[] = [];

  if (system) {
    parts.push(system);
  }

  if (messages) {
    for (const msg of messages) {
      parts.push(msg.content);

      if (msg.toolCallId) {
        parts.push(msg.toolCallId);
      }
      if (msg.toolName) {
        parts.push(msg.toolName);
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push(tc.toolCallId);
          parts.push(tc.toolName);
          parts.push(JSON.stringify(tc.args));
        }
      }
    }
  }

  if (prompt) {
    parts.push(prompt);
  }

  if (tools) {
    for (const [name, tool] of Object.entries(tools)) {
      parts.push(name);
      parts.push(tool.description);
      parts.push(JSON.stringify(z.toJSONSchema(tool.inputSchema)));
    }
  }

  if (schema) {
    parts.push(JSON.stringify(z.toJSONSchema(schema)));
  }

  return estimateTokens(parts.join('\n'));
}
