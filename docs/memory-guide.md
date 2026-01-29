# Memory Guide

This guide covers the memory system in Positronic, which enables brains to store and retrieve long-term memories using [Mem0](https://mem0.ai) or other memory providers.

## Overview

The memory system provides:
- **Long-term memory storage** - Persist facts, preferences, and context across brain runs
- **Semantic search** - Retrieve relevant memories based on natural language queries
- **Automatic conversation indexing** - Optionally store all conversations for later retrieval
- **Tools for agents** - Built-in tools that let agents store and recall memories

## Installation

```bash
npm install @positronic/mem0
```

## Quick Start

```typescript
import { brain } from '@positronic/core';
import { createMem0Provider, createMem0Tools } from '@positronic/mem0';

// 1. Create a memory provider
const memory = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

// 2. Create memory tools
const memoryTools = createMem0Tools();

// 3. Use in a brain with .withMemory()
const myBrain = brain('assistant')
  .withMemory(memory)
  .brain('Help User', () => ({
    system: 'You are helpful. Use rememberFact to store user preferences.',
    prompt: 'The user said: I prefer dark mode',
    tools: {
      ...memoryTools,
      done: {
        description: 'Complete the task',
        inputSchema: z.object({ result: z.string() }),
        terminal: true,
      },
    },
  }));
```

## Setting Up the Memory Provider

### Mem0 Configuration

```typescript
import { createMem0Provider } from '@positronic/mem0';

const memory = createMem0Provider({
  // Required: Your Mem0 API key
  apiKey: process.env.MEM0_API_KEY!,

  // Optional: Custom base URL (defaults to https://api.mem0.ai/v1)
  baseUrl: 'https://api.mem0.ai/v1',

  // Optional: Organization and project IDs for team use
  orgId: 'my-org',
  projectId: 'my-project',
});
```

### Attaching Memory to Brains

Use `.withMemory()` to attach a memory provider to a brain:

```typescript
const myBrain = brain('my-brain')
  .withMemory(memory)
  .step('Process', ({ memory }) => {
    // memory is now available in all steps
    return { processed: true };
  });
```

When you attach memory, all steps and agent blocks receive a `memory` object in their context that's scoped to the current brain (agentId is automatically set to the step/brain title).

## Memory Tools

The package provides two tools that agents can use to interact with memory:

### rememberFact

Stores a fact in long-term memory:

```typescript
import { rememberFact } from '@positronic/mem0';

// The agent can call this tool to store information
// Input: { fact: string, userId?: string }
// Output: { remembered: boolean, fact: string }
```

When the agent calls `rememberFact({ fact: "User prefers dark mode" })`, the fact is stored in Mem0 and can be retrieved later.

### recallMemories

Searches for relevant memories:

```typescript
import { recallMemories } from '@positronic/mem0';

// The agent can call this tool to search memory
// Input: { query: string, userId?: string, limit?: number }
// Output: { found: number, memories: Array<{ content: string, relevance?: number }> }
```

When the agent calls `recallMemories({ query: "user preferences" })`, it receives matching memories with relevance scores.

### Using Memory Tools in Agents

```typescript
import { createMem0Tools } from '@positronic/mem0';

const memoryTools = createMem0Tools();

const myBrain = brain('personalized-assistant')
  .withMemory(memory)
  .brain('Chat', () => ({
    system: `You are a personalized assistant.

Use rememberFact to store important information about the user:
- Preferences (theme, communication style, etc.)
- Context (current projects, goals)
- Any facts they want you to remember

Use recallMemories before responding to check for relevant context.`,
    prompt: userMessage,
    tools: {
      ...memoryTools,
      done: {
        description: 'Send final response',
        inputSchema: z.object({ response: z.string() }),
        terminal: true,
      },
    },
  }));
```

## Automatic Conversation Indexing

The Mem0 adapter automatically stores all agent conversations to memory. This is useful for building up context over time without explicit tool calls.

### Setting Up the Adapter

```typescript
import { BrainRunner } from '@positronic/core';
import { createMem0Adapter, createMem0Provider } from '@positronic/mem0';

const provider = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

const adapter = createMem0Adapter({
  // Required: The memory provider
  provider,

  // Optional: Extract userId from brain options
  getUserId: (options) => options.userId as string,

  // Optional: Include tool calls in indexed conversations
  includeToolCalls: false,
});

// Attach to BrainRunner
const runner = new BrainRunner({
  adapters: [adapter],
  client: myClient,
});

// Run brain - conversations are automatically indexed
await runner.run(myBrain, { options: { userId: 'user-123' } });
```

### Adapter Behavior

- **On agent start**: Buffers the initial prompt as a user message
- **During execution**: Buffers all user and assistant messages
- **On completion**: Flushes buffer to memory provider
- **On error/cancel**: Discards buffer (doesn't store failed conversations)

### Including Tool Calls

By default, tool calls are not included in the indexed conversation. Enable this for full conversation history:

```typescript
const adapter = createMem0Adapter({
  provider,
  includeToolCalls: true, // Stores tool calls and results
});
```

Tool calls are formatted as:
```
[Tool Call: toolName] {"arg": "value"}
[Tool Result: toolName] {"result": "value"}
```

## Accessing Memory in Steps

When memory is attached, you can access it directly in step functions:

### In Regular Steps

```typescript
const myBrain = brain('my-brain')
  .withMemory(memory)
  .step('Load Context', async ({ memory }) => {
    // Search for relevant memories
    const memories = await memory.search('user preferences', {
      userId: 'user-123',
      limit: 5,
    });

    return {
      context: memories.map(m => m.content).join('\n'),
    };
  });
```

### In Agent Steps

```typescript
const myBrain = brain('my-brain')
  .withMemory(memory)
  .brain('Process', async ({ memory }) => {
    // Fetch memories to include in system prompt
    const prefs = await memory.search('user preferences');

    const context = prefs.length > 0
      ? `\n\nUser preferences:\n${prefs.map(p => `- ${p.content}`).join('\n')}`
      : '';

    return {
      system: `You are helpful.${context}`,
      prompt: 'Help the user with their request',
      tools: { /* ... */ },
    };
  });
```

## Helper Functions

The package includes helper functions for common memory patterns:

### formatMemories

Formats an array of memories into a readable string:

```typescript
import { formatMemories } from '@positronic/mem0';

const memories = await memory.search('preferences');

// Basic formatting
const text = formatMemories(memories);
// "1. User prefers dark mode\n2. User likes concise responses"

// With options
const formatted = formatMemories(memories, {
  header: 'Known preferences:',
  includeScores: true,
  emptyText: 'No preferences found',
});
// "Known preferences:\n1. User prefers dark mode (0.95)\n2. User likes concise responses (0.82)"
```

### createMemorySystemPrompt

Creates a system prompt augmented with relevant memories:

```typescript
import { createMemorySystemPrompt } from '@positronic/mem0';

const myBrain = brain('my-brain')
  .withMemory(memory)
  .brain('Chat', async ({ memory }) => {
    const system = await createMemorySystemPrompt(
      memory,
      'You are a helpful assistant.',
      'user context and preferences',
      {
        userId: 'user-123',
        limit: 10,
        memoriesHeader: '\n\nUser context:',
      }
    );

    return { system, prompt: userMessage, tools: { /* ... */ } };
  });
```

### getMemoryContext

Gets just the memory context block for manual prompt construction:

```typescript
import { getMemoryContext } from '@positronic/mem0';

const context = await getMemoryContext(memory, 'user preferences', {
  userId: 'user-123',
  limit: 5,
});

const system = `You are helpful.

${context ? `## User Context\n${context}` : ''}`;
```

## Memory Scoping

Memories are scoped by two identifiers:

### agentId

Automatically set to the brain/step title. Memories are isolated per agent:

```typescript
// These brains have separate memory spaces
brain('support-agent').withMemory(memory)  // agentId = 'support-agent'
brain('sales-agent').withMemory(memory)    // agentId = 'sales-agent'
```

### userId

Optional user-level scoping. Pass when searching or adding:

```typescript
// In tools - passed as parameter
rememberFact({ fact: 'Prefers dark mode', userId: 'user-123' })
recallMemories({ query: 'preferences', userId: 'user-123' })

// In direct memory access
await memory.search('preferences', { userId: 'user-123' });
await memory.add(messages, { userId: 'user-123' });
```

## Complete Example

Here's a complete example of a personalized assistant that remembers user preferences:

```typescript
import { brain, BrainRunner } from '@positronic/core';
import {
  createMem0Provider,
  createMem0Tools,
  createMem0Adapter,
  createMemorySystemPrompt,
} from '@positronic/mem0';
import { z } from 'zod';

// Setup
const provider = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

const adapter = createMem0Adapter({
  provider,
  getUserId: (options) => options.userId as string,
});

const memoryTools = createMem0Tools();

// Define brain
const assistant = brain('personal-assistant')
  .withMemory(provider)
  .withOptionsSchema(z.object({
    userId: z.string(),
    message: z.string(),
  }))
  .brain('Respond', async ({ memory, options }) => {
    // Build system prompt with memory context
    const system = await createMemorySystemPrompt(
      memory,
      `You are a personalized assistant. You remember user preferences and context.

When the user shares preferences or important information, use rememberFact to store it.
When you need context, use recallMemories to search your memory.`,
      'user preferences and context',
      { userId: options.userId, limit: 10 }
    );

    return {
      system,
      prompt: options.message,
      tools: {
        ...memoryTools,
        done: {
          description: 'Send the final response to the user',
          inputSchema: z.object({ response: z.string() }),
          terminal: true,
        },
      },
    };
  });

// Run with adapter for automatic conversation indexing
const runner = new BrainRunner({
  adapters: [adapter],
  client: myClient,
});

const result = await runner.run(assistant, {
  options: {
    userId: 'user-123',
    message: 'I prefer dark mode and concise responses',
  },
});
```

## Custom Memory Providers

You can implement your own memory provider by implementing the `MemoryProvider` interface:

```typescript
import type { MemoryProvider, Memory, MemoryScope, MemoryMessage } from '@positronic/core';

const customProvider: MemoryProvider = {
  async search(query, scope, options) {
    // Your search implementation
    return [
      { id: '1', content: 'Memory content', score: 0.95 },
    ];
  },

  async add(messages, scope, options) {
    // Your storage implementation
  },
};

// Use like any provider
const myBrain = brain('my-brain')
  .withMemory(customProvider)
  // ...
```
