import { z } from 'zod';

/**
 * Tool choice configuration for LLM calls.
 * - 'auto': Model chooses whether to call tools (default for most cases)
 * - 'required': Model must call a tool (default for agent loops)
 * - 'none': Model cannot call tools
 */
export type ToolChoice = 'auto' | 'required' | 'none';

/**
 * Represents a message in a conversation, used as input for the Generator.
 */
export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

/**
 * Represents a tool call made by the assistant.
 */
export type ToolCall = {
  type: 'tool_use';
  toolCallId: string;
  toolName: string;
  args: unknown;
};

/**
 * Represents a message in a tool-calling conversation.
 * Extends Message to include tool messages and assistant tool calls.
 */
export type ToolMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** For 'tool' role: the ID of the tool call this is a result for */
  toolCallId?: string;
  /** For 'tool' role: the name of the tool */
  toolName?: string;
  /** For 'assistant' role: tool calls made by the assistant */
  toolCalls?: ToolCall[];
};

/**
 * Opaque message type returned by the AI SDK.
 * This preserves provider-specific metadata (like Gemini's thoughtSignature)
 * that must be passed back in subsequent calls.
 */
export type ResponseMessage = unknown;

/**
 * Interface for AI model interactions, focused on generating structured objects
 * and potentially other types of content in the future.
 */
export interface ObjectGenerator {
  /**
   * Generates a structured JSON object that conforms to the provided Zod schema.
   *
   * This method supports both simple single-string prompts and more complex
   * multi-turn conversations via the `messages` array.
   */
  generateObject<T extends z.AnyZodObject>(params: {
    /**
     * The definition of the expected output object, including its Zod schema
     * and a name for state management within the brain.
     */
    schema: T;
    schemaName: string;
    schemaDescription?: string;

    /**
     * A simple prompt string for single-turn requests.
     * If provided, this will typically be treated as the latest user input.
     * If `messages` are also provided, this `prompt` is usually appended
     * as a new user message to the existing `messages` array.
     */
    prompt?: string;

    /**
     * An array of messages forming the conversation history.
     * Use this for multi-turn conversations or when you need to provide
     * a sequence of interactions (e.g., user, assistant, tool calls).
     * If `prompt` is also provided, it's typically added to this history.
     */
    messages?: Message[];

    /**
     * An optional system-level instruction or context to guide the model's
     * behavior for the entire interaction. Implementations will typically
     * prepend this as a `system` role message to the full message list.
     */
    system?: string;
  }): Promise<z.infer<T>>;

  /**
   * Creates a tool result message in the SDK-native format.
   * Use this to append tool results to responseMessages before the next generateText call.
   */
  createToolResultMessage?(
    toolCallId: string,
    toolName: string,
    result: unknown
  ): ResponseMessage;

  /**
   * Generates text with optional tool calling support.
   * Used by loop steps for agentic workflows.
   */
  generateText?(params: {
    /** System prompt for the LLM */
    system?: string;
    /**
     * Conversation messages for initial setup (used on first call only).
     */
    messages: ToolMessage[];
    /**
     * Messages returned from a previous generateText call.
     * These preserve provider-specific metadata (like Gemini's thoughtSignature)
     * and should be used for subsequent calls in a conversation.
     */
    responseMessages?: ResponseMessage[];
    /** Available tools for the LLM to call */
    tools: Record<string, { description: string; inputSchema: z.ZodSchema }>;
    /**
     * Tool choice configuration.
     * - 'auto': Model chooses whether to call tools
     * - 'required': Model must call a tool (recommended for agent loops)
     * - 'none': Model cannot call tools
     * Defaults to 'required' for agent workflows.
     */
    toolChoice?: ToolChoice;
  }): Promise<{
    /** Text response from the LLM */
    text?: string;
    /** Tool calls made by the LLM */
    toolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
    }>;
    /** Token usage information */
    usage: { totalTokens: number };
    /**
     * Response messages from the SDK that preserve provider metadata.
     * Pass these back in the next call via responseMessages parameter.
     */
    responseMessages: ResponseMessage[];
  }>;

  /**
   * Generates text with multi-step tool calling support.
   * Used for agentic workflows that require multiple LLM iterations.
   *
   * Unlike generateText (single step), this method:
   * - Executes tools and feeds results back to the LLM automatically
   * - Continues until maxSteps reached or LLM stops calling tools
   * - Returns all tool calls with their results
   *
   * This is a thin wrapper around the underlying SDK's multi-step capabilities
   * (e.g., Vercel AI SDK's stopWhen: stepCountIs()).
   */
  streamText(params: {
    /** System prompt for the LLM */
    system?: string;
    /** Initial user prompt */
    prompt: string;
    /** Conversation messages (optional, for context) */
    messages?: ToolMessage[];
    /** Available tools for the LLM to call */
    tools: Record<
      string,
      {
        description: string;
        inputSchema: z.ZodSchema;
        execute?: (args: unknown) => Promise<unknown> | unknown;
      }
    >;
    /** Maximum number of LLM iterations (default: 10) */
    maxSteps?: number;
    /**
     * Tool choice configuration.
     * - 'auto': Model chooses whether to call tools (default)
     * - 'required': Model must call a tool
     * - 'none': Model cannot call tools
     * Defaults to 'auto' for streamText since it often needs to produce final text.
     */
    toolChoice?: ToolChoice;
  }): Promise<{
    /** All tool calls made across all steps, with their results */
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: unknown;
    }>;
    /** Final text response (if any) */
    text?: string;
    /** Token usage across all steps */
    usage: { totalTokens: number };
  }>;
}
