# Memory Guide

This guide covers the memory system in Positronic, which enables brains to store and retrieve long-term memories using [Mem0](https://mem0.ai) or other memory providers.

## Overview

The memory system provides:
- **Long-term memory storage** - Persist facts, preferences, and context across brain runs
- **Semantic search** - Retrieve relevant memories based on natural language queries
- **Automatic conversation indexing** - Optionally store all conversations for later retrieval
- **Tools for agents** - Built-in tools that let agents store and recall memories
- **Automatic user scoping** - Memories are scoped to the current user via `currentUser`, no manual userId threading needed

## Quick Start

### 1. Install the package

```bash
npm install @positronic/mem0
```

### 2. Set up the provider

Add your Mem0 API key to `.env`:

```bash
MEM0_API_KEY=your-api-key-here
```

### 3. Configure in runner.ts

The memory provider is configured on the runner via the `providers` bag, not on `createBrain`:

```typescript
import { BrainRunner } from '@positronic/core';
import { createMem0Provider } from '@positronic/mem0';

const memory = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

export const runner = new BrainRunner({
  client: myClient,
  providers: {
    memory,
  },
});
```

### 4. Use memory tools in agents

```typescript
import { brain } from '../brain.js';
import { createMem0Tools } from '@positronic/mem0';
import { z } from 'zod';

const memoryTools = createMem0Tools();

export default brain('assistant')
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

## Memory Tools

The package provides two tools that agents can use:

### rememberFact

Stores a fact in long-term memory.

- **Input**: `{ fact: string }`
- **Output**: `{ remembered: boolean, fact: string }`

When the agent calls `rememberFact({ fact: "User prefers dark mode" })`, the fact is stored in Mem0 and can be retrieved later.

### recallMemories

Searches for relevant memories.

- **Input**: `{ query: string, limit?: number }`
- **Output**: `{ found: number, memories: Array<{ content: string, relevance?: number }> }`

When the agent calls `recallMemories({ query: "user preferences" })`, it receives matching memories with relevance scores.

### Using Memory Tools in Agents

```typescript
import { brain } from '../brain.js';
import { createMem0Tools } from '@positronic/mem0';
import { z } from 'zod';

const memoryTools = createMem0Tools();

export default brain('personalized-assistant')
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

The Mem0 adapter automatically stores all agent conversations to memory. This builds up context over time without explicit tool calls.

### Setting Up the Adapter

In your `runner.ts`:

```typescript
import { BrainRunner } from '@positronic/core';
import { createMem0Adapter, createMem0Provider } from '@positronic/mem0';

const provider = createMem0Provider({
  apiKey: process.env.MEM0_API_KEY!,
});

const adapter = createMem0Adapter({ provider });

export const runner = new BrainRunner({
  adapters: [adapter],
  client: myClient,
  providers: {
    memory: provider,
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
  includeToolCalls: true,
});
```

## Accessing Memory in Steps

When memory is attached, you can access it directly in step functions:

### In Regular Steps

```typescript
export default brain('my-brain')
  .step('Load Context', async ({ memory }) => {
    const memories = await memory.search('user preferences', {
      limit: 5,
    });

    return {
      context: memories.map(m => m.content).join('\n'),
    };
  });
```

### In Agent Config Functions

```typescript
export default brain('my-brain')
  .brain('Process', async ({ memory }) => {
    const prefs = await memory.search('user preferences');

    const context = prefs.length > 0
      ? '\n\nUser preferences:\n' + prefs.map(p => '- ' + p.content).join('\n')
      : '';

    return {
      system: 'You are helpful.' + context,
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

const text = formatMemories(memories);
// "1. User prefers dark mode\n2. User likes concise responses"

const formatted = formatMemories(memories, {
  header: 'Known preferences:',
  includeScores: true,
  emptyText: 'No preferences found',
});
```

### createMemorySystemPrompt

Creates a system prompt augmented with relevant memories:

```typescript
import { createMemorySystemPrompt } from '@positronic/mem0';

export default brain('my-brain')
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

    return { system, prompt: userMessage, tools: { /* ... */ } };
  });
```

### getMemoryContext

Gets just the memory context block for manual prompt construction:

```typescript
import { getMemoryContext } from '@positronic/mem0';

const context = await getMemoryContext(memory, 'user preferences', {
  limit: 5,
});

const system = 'You are helpful.\n\n' + (context ? '## User Context\n' + context : '');
```

## Memory Scoping

Memories are scoped by two identifiers:

### agentId

Automatically set to the brain/step title. Memories are isolated per agent:

```typescript
brain('support-agent').withMemory()  // agentId = 'support-agent'
brain('sales-agent').withMemory()    // agentId = 'sales-agent'
```

### userId

Automatically set from `currentUser.name` when the brain runs. All memory operations are automatically scoped to the current user — no need to pass userId manually:

```typescript
// userId is auto-bound from currentUser — just use memory directly
await memory.search('preferences');
await memory.add(messages);

// In tools — the agent just passes the fact/query, userId is automatic
rememberFact({ fact: 'Prefers dark mode' })
recallMemories({ query: 'preferences' })
```

See the [currentUser section in positronic-guide.md](positronic-guide.md#currentuser) for how to set the current user when running brains.
