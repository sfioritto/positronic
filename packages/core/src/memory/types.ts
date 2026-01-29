/**
 * Memory types for the Positronic memory system.
 *
 * The memory system provides a provider-agnostic interface for storing and
 * retrieving long-term memories. Memory providers implement the raw interface,
 * and brain steps receive a scoped memory instance with the agent ID pre-bound.
 */

/**
 * A single memory entry returned from search operations.
 */
export interface Memory {
  /** Unique identifier for this memory */
  id: string;
  /** The memory content */
  content: string;
  /** Relevance score from 0-1 (optional, provider-dependent) */
  score?: number;
  /** Additional metadata about the memory */
  metadata?: Record<string, unknown>;
}

/**
 * Message format for adding memories.
 * Compatible with common conversation formats.
 */
export interface MemoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Scope parameters for memory operations.
 * Used to namespace memories by agent and optionally by user.
 */
export interface MemoryScope {
  /** The agent/brain ID this memory belongs to */
  agentId: string;
  /** Optional user ID for user-specific memories */
  userId?: string;
}

/**
 * Search options for memory retrieval.
 */
export interface MemorySearchOptions {
  /** Optional user ID to scope the search */
  userId?: string;
  /** Maximum number of memories to return */
  limit?: number;
}

/**
 * Options for adding memories.
 */
export interface MemoryAddOptions {
  /** Optional user ID to scope the memory */
  userId?: string;
  /** Additional metadata to store with the memory */
  metadata?: Record<string, unknown>;
}

/**
 * Raw memory provider interface.
 * Implementations handle the actual storage and retrieval of memories.
 * All methods take the full scope (agentId + optional userId).
 */
export interface MemoryProvider {
  /**
   * Search for relevant memories.
   *
   * @param query - The search query
   * @param scope - The scope including agentId and optional userId
   * @param options - Additional search options
   * @returns Array of matching memories
   */
  search(
    query: string,
    scope: MemoryScope,
    options?: { limit?: number }
  ): Promise<Memory[]>;

  /**
   * Add memories from a conversation.
   *
   * @param messages - Array of messages to extract memories from
   * @param scope - The scope including agentId and optional userId
   * @param options - Additional options like metadata
   */
  add(
    messages: MemoryMessage[],
    scope: MemoryScope,
    options?: { metadata?: Record<string, unknown> }
  ): Promise<void>;
}

/**
 * Scoped memory interface with agentId pre-bound.
 * This is what brain steps receive - they don't need to pass agentId.
 */
export interface ScopedMemory {
  /**
   * Search for relevant memories.
   *
   * @param query - The search query
   * @param options - Optional search options (userId, limit)
   * @returns Array of matching memories
   */
  search(query: string, options?: MemorySearchOptions): Promise<Memory[]>;

  /**
   * Add memories from messages.
   *
   * @param messages - Array of messages to extract memories from
   * @param options - Optional options (userId, metadata)
   */
  add(messages: MemoryMessage[], options?: MemoryAddOptions): Promise<void>;
}
