import { z } from 'zod';

/**
 * Represents a message in a conversation, used as input for the Generator.
 */
export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

/**
 * Defines the expected structure and metadata for a generated object.
 */
export type ResponseModel<T extends z.AnyZodObject> = {
  schema: T;
  name: string;
  description?: string;
};

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
     * and a name for state management within the workflow.
     */
    outputSchema: ResponseModel<T>;

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

    /**
     * Optional configuration specific to the language model or provider.
     */
    modelConfig?: {
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      [key: string]: any;
    };
  }): Promise<z.infer<T>>;
}
