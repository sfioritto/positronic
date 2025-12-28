import {
  BrainRunner,
  type ObjectGenerator,
  type Message,
  type ToolMessage,
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

  generateText: async (params: {
    system?: string;
    messages: ToolMessage[];
    tools: Record<string, { description: string; inputSchema: z.ZodSchema }>;
  }) => {
    generateTextCallCount++;

    // If an error is configured, throw it (simulates API errors like rate limits)
    if (mockError) {
      const error = mockError;
      mockError = null; // Reset after throwing
      throw error;
    }

    // Check if we have tool messages - if the last one is a tool response,
    // the LLM should respond with text or call another tool
    const lastMessage = params.messages[params.messages.length - 1];

    // If the last message is a tool result, check if it's from a webhook response
    // In that case, call the terminal tool to complete the loop
    if (lastMessage?.role === 'tool' && generateTextCallCount > 1) {
      // After receiving tool result (especially from webhook), call finish tool
      return {
        text: 'Received the webhook response, finishing task.',
        toolCalls: [
          {
            toolCallId: `finish-${generateTextCallCount}`,
            toolName: 'finish',
            args: { result: 'completed after webhook response' },
          },
        ],
        usage: { totalTokens: 50 },
      };
    }

    // First call - call the escalate tool that will suspend on webhook
    return {
      text: 'I need to escalate this to a human.',
      toolCalls: [
        {
          toolCallId: `escalate-${generateTextCallCount}`,
          toolName: 'escalate',
          args: { reason: 'need human review' },
        },
      ],
      usage: { totalTokens: 100 },
    };
  },
};

export const runner = new BrainRunner({
  adapters: [],
  client: mockClient,
});
