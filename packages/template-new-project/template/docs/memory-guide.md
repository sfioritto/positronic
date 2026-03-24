# Memory Guide

This guide covers the memory system in Positronic, which enables brains to store and retrieve long-term memories using [Mem0](https://mem0.ai) via the `mem0` plugin.

## Overview

The memory system provides:
- **Long-term memory storage** - Persist facts, preferences, and context across brain runs
- **Semantic search** - Retrieve relevant memories based on natural language queries
- **Automatic conversation indexing** - Optionally store all conversations for later retrieval
- **Tools for prompt loops** - Built-in tools that let LLMs store and recall memories
- **Automatic user scoping** - Memories are scoped to the current user via `currentUser`, no manual userId threading needed

## Quick Start

### 1. Install the package

```bash
npm install @positronic/mem0
```

### 2. Set up the API key

Add your Mem0 API key to `.env`:

```bash
MEM0_API_KEY=your-api-key-here
```

### 3. Add the plugin to your project brain

Configure the mem0 plugin in `src/brain.ts` so all brains get memory:

```typescript
import { createBrain } from '@positronic/core';
import { mem0 } from '@positronic/mem0';
import { components } from './components/index.js';

export const brain = createBrain({
  plugins: [mem0.setup({ apiKey: process.env.MEM0_API_KEY! })],
  components,
});
```

Or add it to a single brain with `.withPlugin()`:

```typescript
import { brain } from '../brain.js';
import { mem0 } from '@positronic/mem0';

export default brain('assistant')
  .withPlugin(mem0.setup({ apiKey: process.env.MEM0_API_KEY! }))
  .step('Load Context', async ({ mem0: m }) => {
    const memories = await m.search('user preferences');
    return { context: memories.map(m => m.content).join('\n') };
  });
```

### 4. Use memory tools in prompt loops

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

export default brain('assistant')
  .prompt('Help User', ({ mem0: m }) => ({
    message: 'The user said: I prefer dark mode',
    outputSchema: z.object({ result: z.string() }),
    loop: {
      tools: {
        ...m.tools,
        done: {
          description: 'Complete the task',
          inputSchema: z.object({ result: z.string() }),
          terminal: true,
        },
      },
    },
  }));
```

## Memory Tools

The plugin provides two tools on `mem0.tools` that LLMs can call during prompt loops:

### rememberFact

Stores a fact in long-term memory.

- **Input**: `{ fact: string }`
- **Output**: `{ remembered: boolean, fact: string }`

When the LLM calls `rememberFact({ fact: "User prefers dark mode" })`, the fact is stored in Mem0 and can be retrieved later.

### recallMemories

Searches for relevant memories.

- **Input**: `{ query: string, limit?: number }`
- **Output**: `{ found: number, memories: Array<{ content: string, relevance?: number }> }`

When the LLM calls `recallMemories({ query: "user preferences" })`, it receives matching memories with relevance scores.

### Using Memory Tools in Prompt Loops

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

export default brain('personalized-assistant')
  .prompt('Chat', ({ mem0: m }) => ({
    message: userMessage,
    outputSchema: z.object({ response: z.string() }),
    loop: {
      tools: {
        ...m.tools,
        done: {
          description: 'Send final response',
          inputSchema: z.object({ response: z.string() }),
          terminal: true,
        },
      },
    },
  }));
```

## Automatic Conversation Indexing

The mem0 plugin includes a built-in adapter that automatically indexes conversations to memory. When a brain completes, the adapter flushes buffered messages to Mem0. This builds up context over time without explicit tool calls.

### Adapter Behavior

- **On completion**: Flushes buffered messages to memory provider
- **On error/cancel**: Discards buffer (doesn't store failed conversations)

### Disabling Auto-Indexing

Auto-indexing is enabled by default. To disable it:

```typescript
mem0.setup({
  apiKey: process.env.MEM0_API_KEY!,
  autoIndex: false,
})
```

## Accessing Memory in Steps

When the mem0 plugin is attached, you can access it directly in step functions via `mem0` on the context. Destructure it as `mem0: m` to avoid shadowing the import:

### In Regular Steps

```typescript
export default brain('my-brain')
  .step('Load Context', async ({ mem0: m }) => {
    const memories = await m.search('user preferences', {
      limit: 5,
    });

    return {
      context: memories.map(m => m.content).join('\n'),
    };
  });
```

### In Prompt Config Functions

```typescript
export default brain('my-brain')
  .prompt('Process', async ({ mem0: m }) => {
    const prefs = await m.search('user preferences');

    const context = prefs.length > 0
      ? '\n\nUser preferences:\n' + prefs.map(p => '- ' + p.content).join('\n')
      : '';

    return {
      message: 'Help the user with their request',
      system: 'You are helpful.' + context,
      outputSchema: z.object({ response: z.string() }),
    };
  });
```

## Helper Functions

The package includes helper functions for common memory patterns. These accept any object with `search` and `add` methods, so the `mem0` plugin injection works directly.

### formatMemories

Formats an array of memories into a readable string:

```typescript
import { formatMemories } from '@positronic/mem0';

const memories = await m.search('preferences');

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
  .prompt('Chat', async ({ mem0: m }) => {
    const system = await createMemorySystemPrompt(
      m,
      'You are a helpful assistant.',
      'user context and preferences',
      {
        limit: 10,
        memoriesHeader: '\n\nUser context:',
      }
    );

    return {
      message: userMessage,
      system,
      outputSchema: z.object({ response: z.string() }),
    };
  });
```

### getMemoryContext

Gets just the memory context block for manual prompt construction:

```typescript
import { getMemoryContext } from '@positronic/mem0';

const context = await getMemoryContext(m, 'user preferences', {
  limit: 5,
});

const system = 'You are helpful.\n\n' + (context ? '## User Context\n' + context : '');
```

## Plugin Configuration

### Required Options

- `apiKey` — your Mem0 API key

### Optional Options

- `scope` — memory scoping mode (see Memory Scoping below)
  - `'user'` — memories are shared across all brains for each user
  - `'brain'` — memories are shared across all users for each brain
  - Default: per-brain-per-user (memories are isolated by both brain and user)
- `autoIndex` — whether to auto-index conversations on brain completion (default: `true`)
- `baseUrl` — custom Mem0 API base URL
- `orgId` — Mem0 organization ID
- `projectId` — Mem0 project ID

```typescript
mem0.setup({
  apiKey: process.env.MEM0_API_KEY!,
  scope: 'user',
  autoIndex: false,
})
```

## Memory Scoping

Memories are scoped by two identifiers that are set automatically:

### agentId

Automatically set to the brain title. Memories are isolated per brain by default:

```typescript
brain('support-agent')    // agentId = 'support-agent'
  .withPlugin(mem0.setup({ apiKey: '...' }))

brain('sales-agent')      // agentId = 'sales-agent'
  .withPlugin(mem0.setup({ apiKey: '...' }))
```

With `scope: 'user'`, the agentId is cleared so memories are shared across brains for each user.

### userId

Automatically set from `currentUser.name` when the brain runs. All memory operations are automatically scoped to the current user — no need to pass userId manually:

```typescript
// userId is auto-bound from currentUser — just use mem0 directly
await m.search('preferences');
await m.add([{ role: 'user', content: 'test' }]);

// In tools — the LLM just passes the fact/query, userId is automatic
rememberFact({ fact: 'Prefers dark mode' })
recallMemories({ query: 'preferences' })
```

With `scope: 'brain'`, the userId is cleared so memories are shared across users for each brain.

See the [currentUser section in positronic-guide.md](positronic-guide.md#currentuser) for how to set the current user when running brains.
