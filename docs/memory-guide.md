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
import { createMem0Tools } from '@positronic/mem0';

// 1. Create memory tools
const memoryTools = createMem0Tools();

// 2. Use in a brain with .withMemory() — just an opt-in flag
const myBrain = brain('assistant')
  .withMemory()
  .brain('Help User', () => ({
    system: 'You are helpful. Use rememberFact to store user preferences.',
    prompt: 'The user said: I prefer dark mode',
    tools: {
      ...memoryTools,
    },
    outputSchema: {
      schema: z.object({ result: z.string() }),
      name: 'helpResult' as const,
    },
  }));
```

The memory provider is configured on the runner side (see [Runner Configuration](#runner-configuration) below), not on the brain. Brain authors just call `.withMemory()` and use `memory.search()` / `memory.add()` in steps.

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

Use `.withMemory()` to opt a brain into memory. It takes no arguments — it's just a flag:

```typescript
const myBrain = brain('my-brain')
  .withMemory()
  .step('Process', ({ memory }) => {
    // memory is now available in all steps
    return { processed: true };
  });
```

When you call `.withMemory()`, all steps receive a `memory` object in their context that's scoped to the current brain and user. The actual memory provider is configured on the runner side (see [Runner Configuration](#runner-configuration) below).

### Runner Configuration

The memory provider factory is passed to the runner via the `providers` bag — not to the brain. In generated projects, the runner/backend handles this automatically, so brain authors just call `.withMemory()`.

```typescript
import { createMem0Provider } from '@positronic/mem0';
import { createScopedMemory } from '@positronic/core';

const provider = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

// Pass the memory provider factory in the runner's providers bag
brain.run({
  client: myClient,
  currentUser: { name: 'user-123' },
  providers: {
    memory: (ctx) =>
      createScopedMemory(provider, ctx.brainTitle, ctx.currentUser.name),
  },
});
```

## Memory Tools

The package provides two tools that can be used in prompt loop steps to interact with memory:

### rememberFact

Stores a fact in long-term memory:

```typescript
import { rememberFact } from '@positronic/mem0';

// The LLM can call this tool to store information
// Input: { fact: string }
// Output: { remembered: boolean, fact: string }
```

When the LLM calls `rememberFact({ fact: "User prefers dark mode" })`, the fact is stored in Mem0 and can be retrieved later.

### recallMemories

Searches for relevant memories:

```typescript
import { recallMemories } from '@positronic/mem0';

// The LLM can call this tool to search memory
// Input: { query: string, limit?: number }
// Output: { found: number, memories: Array<{ content: string, relevance?: number }> }
```

When the LLM calls `recallMemories({ query: "user preferences" })`, it receives matching memories with relevance scores.

### Using Memory Tools in Prompt Loops

```typescript
import { createMem0Tools } from '@positronic/mem0';

const memoryTools = createMem0Tools();

const myBrain = brain('personalized-assistant')
  .withMemory()
  .prompt('Chat', () => ({
    system: `You are a personalized assistant.

Use rememberFact to store important information about the user:
- Preferences (theme, communication style, etc.)
- Context (current projects, goals)
- Any facts they want you to remember

Use recallMemories before responding to check for relevant context.`,
    message: userMessage,
    outputSchema: z.object({ response: z.string() }),
    loop: {
      tools: { ...memoryTools },
    },
  }));
```

## Automatic Conversation Indexing

The Mem0 adapter automatically stores all prompt loop conversations to memory. This is useful for building up context over time without explicit tool calls.

### Setting Up the Adapter

```typescript
import { createScopedMemory } from '@positronic/core';
import { createMem0Adapter, createMem0Provider } from '@positronic/mem0';

const provider = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

const adapter = createMem0Adapter({ provider });

// Attach to BrainRunner
const runner = new BrainRunner({
  adapters: [adapter],
  client: myClient,
});

// Run brain — memory provider goes in providers bag, conversations are automatically indexed
await runner.run(myBrain, {
  currentUser: { name: 'user-123' },
  providers: {
    memory: (ctx) =>
      createScopedMemory(provider, ctx.brainTitle, ctx.currentUser.name),
  },
});
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
  .withMemory()
  .step('Load Context', async ({ memory }) => {
    // Search for relevant memories (userId auto-scoped from currentUser)
    const memories = await memory.search('user preferences', {
      limit: 5,
    });

    return {
      context: memories.map((m) => m.content).join('\n'),
    };
  });
```

### In Agent Steps

```typescript
const myBrain = brain('my-brain')
  .withMemory()
  .brain('Process', async ({ memory }) => {
    // Fetch memories to include in system prompt
    const prefs = await memory.search('user preferences');

    const context =
      prefs.length > 0
        ? `\n\nUser preferences:\n${prefs
            .map((p) => `- ${p.content}`)
            .join('\n')}`
        : '';

    return {
      system: `You are helpful.${context}`,
      prompt: 'Help the user with their request',
      tools: {
        /* ... */
      },
      outputSchema: {
        schema: z.object({ result: z.string() }),
        name: 'processResult' as const,
      },
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
  .withMemory()
  .brain('Chat', async ({ memory }) => {
    const system = await createMemorySystemPrompt(
      memory,
      'You are a helpful assistant.',
      'user context and preferences',
      {
        limit: 10,
        memoriesHeader: '\n\nUser context:',
      }
    );

    return {
      system,
      prompt: userMessage,
      tools: {
        /* ... */
      },
      outputSchema: {
        schema: z.object({ reply: z.string() }),
        name: 'chatReply' as const,
      },
    };
  });
```

### getMemoryContext

Gets just the memory context block for manual prompt construction:

```typescript
import { getMemoryContext } from '@positronic/mem0';

const context = await getMemoryContext(memory, 'user preferences', {
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
brain('support-agent').withMemory(); // agentId = 'support-agent'
brain('sales-agent').withMemory(); // agentId = 'sales-agent'
```

### userId

Automatically set from `currentUser.name` when the brain runs. All memory operations are automatically scoped to the current user — no need to pass `userId` manually:

```typescript
// userId is auto-bound from currentUser — just use memory directly
await memory.search('preferences');
await memory.add(messages);

// In tools — the agent just passes the fact/query, userId is automatic
rememberFact({ fact: 'Prefers dark mode' });
recallMemories({ query: 'preferences' });
```

## Complete Example

Here's a complete example of a personalized assistant that remembers user preferences:

```typescript
import { brain, BrainRunner, createScopedMemory } from '@positronic/core';
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

const adapter = createMem0Adapter({ provider });

const memoryTools = createMem0Tools();

// Define brain — just opt in with .withMemory(), no provider needed here
const assistant = brain('personal-assistant')
  .withMemory()
  .withOptionsSchema(
    z.object({
      message: z.string(),
    })
  )
  .brain('Respond', async ({ memory, options }) => {
    // Build system prompt with memory context (userId auto-scoped from currentUser)
    const system = await createMemorySystemPrompt(
      memory,
      `You are a personalized assistant. You remember user preferences and context.

When the user shares preferences or important information, use rememberFact to store it.
When you need context, use recallMemories to search your memory.`,
      'user preferences and context',
      { limit: 10 }
    );

    return {
      system,
      prompt: options.message,
      tools: {
        ...memoryTools,
      },
      outputSchema: {
        schema: z.object({ response: z.string() }),
        name: 'assistantResponse' as const,
      },
    };
  });

// Run with adapter for automatic conversation indexing
// Memory provider goes in the providers bag on the runner side
const runner = new BrainRunner({
  adapters: [adapter],
  client: myClient,
});

const result = await runner.run(assistant, {
  currentUser: { name: 'user-123' },
  options: {
    message: 'I prefer dark mode and concise responses',
  },
  providers: {
    memory: (ctx) =>
      createScopedMemory(provider, ctx.brainTitle, ctx.currentUser.name),
  },
});
```

## Custom Memory Providers

You can implement your own memory provider by implementing the `MemoryProvider` interface:

```typescript
import type {
  MemoryProvider,
  MemoryEntry,
  MemoryScope,
  MemoryMessage,
} from '@positronic/core';

const customProvider: MemoryProvider = {
  async search(query, scope, options) {
    // Your search implementation
    // Returns MemoryEntry[] (individual memory entries)
    return [{ id: '1', content: 'Memory content', score: 0.95 }];
  },

  async add(messages, scope, options) {
    // Your storage implementation
  },
};

// Brain side: just opt in with .withMemory()
const myBrain = brain('my-brain').withMemory();

// Runner side: pass the custom provider via the providers bag
myBrain.run({
  client: myClient,
  currentUser: { name: 'user-123' },
  providers: {
    memory: (ctx) =>
      createScopedMemory(customProvider, ctx.brainTitle, ctx.currentUser.name),
  },
});
```
