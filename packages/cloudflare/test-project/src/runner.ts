import {
  BrainRunner,
  type ObjectGenerator,
  type Message,
  type ToolMessage,
  type ResponseMessage,
} from '@positronic/core';
import { z } from 'zod';

// Track generateText calls for testing - allows mocking specific tool calls
let generateTextCallCount = 0;
let pendingToolResponse: unknown | null = null;
let mockError: Error | null = null;

export function setMockToolResponse(response: unknown) {
  pendingToolResponse = response;
}

/**
 * Configure the mock client to throw an error on the next generateText call.
 * Use this to simulate API errors like "request too large" or rate limits.
 */
export function setMockError(error: Error | null) {
  mockError = error;
}

export function resetMockState() {
  generateTextCallCount = 0;
  pendingToolResponse = null;
  mockError = null;
}

/**
 * Helper to build mock responseMessages from a tool call response.
 * This mimics what real clients return from generateText.
 */
function buildResponseMessages(
  existingMessages: ResponseMessage[] | undefined,
  text: string | undefined,
  toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }> | undefined
): ResponseMessage[] {
  const messages: ResponseMessage[] = existingMessages ? [...existingMessages] : [];

  // Add assistant message with text and/or tool calls
  const assistantContent: Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  > = [];

  if (text) {
    assistantContent.push({ type: 'text', text });
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.args,
      });
    }
  }

  if (assistantContent.length > 0) {
    messages.push({ role: 'assistant', content: assistantContent } as ResponseMessage);
  }

  return messages;
}

// A simple mock client for testing purposes
const mockClient: ObjectGenerator = {
  generateObject: async <T>(params: {
    schema: T;
    schemaName: string;
    schemaDescription?: string;
    prompt?: string;
    messages?: Message[];
    system?: string;
  }) => {
    return Promise.resolve({} as any);
  },

  createToolResultMessage(
    toolCallId: string,
    toolName: string,
    result: unknown
  ): ResponseMessage {
    // Match the format used by VercelClient - SDK expects { type: 'text', value: ... }
    const outputValue = typeof result === 'string' ? result : JSON.stringify(result);
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: { type: 'text', value: outputValue },
        },
      ],
    } as ResponseMessage;
  },

  generateText: async (params: {
    system?: string;
    messages: ToolMessage[];
    responseMessages?: ResponseMessage[];
    tools: Record<string, { description: string; inputSchema: z.ZodSchema }>;
  }) => {
    generateTextCallCount++;

    // If an error is configured, throw it (simulates API errors like rate limits)
    if (mockError) {
      const error = mockError;
      mockError = null; // Reset after throwing
      throw error;
    }

    // Use responseMessages if provided (for resume), otherwise check messages
    const hasToolResult = params.responseMessages
      ? params.responseMessages.some((msg: any) => msg.role === 'tool')
      : params.messages.some((msg) => msg.role === 'tool');

    // If the last message is a tool result, check if it's from a webhook response
    // In that case, call the terminal tool to complete the loop
    if (hasToolResult && generateTextCallCount > 1) {
      // After receiving tool result (especially from webhook), call finish tool
      const text = 'Received the webhook response, finishing task.';
      const toolCalls = [
        {
          toolCallId: `finish-${generateTextCallCount}`,
          toolName: 'done',
          args: { result: 'completed after webhook response' },
        },
      ];
      return {
        text,
        toolCalls,
        usage: { totalTokens: 50 },
        responseMessages: buildResponseMessages(params.responseMessages, text, toolCalls),
      };
    }

    // First call - call the escalate tool that will suspend on webhook
    const text = 'I need to escalate this to a human.';
    const toolCalls = [
      {
        toolCallId: `escalate-${generateTextCallCount}`,
        toolName: 'escalate',
        args: { reason: 'need human review' },
      },
    ];
    return {
      text,
      toolCalls,
      usage: { totalTokens: 100 },
      responseMessages: buildResponseMessages(params.responseMessages, text, toolCalls),
    };
  },

  streamText: async () => {
    throw new Error('streamText not implemented in mock');
  },
};

export const runner = new BrainRunner({
  adapters: [],
  client: mockClient,
});
