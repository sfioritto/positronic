# Agent Steps Guide

This guide covers the agent step functionality in Positronic brains - a powerful way to create LLM-powered agents that can use tools, generate UI, and interact with external systems.

## Overview

Agent steps allow you to define LLM agents directly within your brain workflow. An agent:
- Has a system prompt and initial user prompt
- Can use tools to perform actions
- Can suspend execution to wait for external events (webhooks)
- Can generate UI and wait for user responses

## Project Setup with `createBrain`

The recommended way to set up brains in a Positronic project is using `createBrain`. This provides type-safe access to services and supports both the builder pattern and direct agent creation.

```typescript
// brain.ts - your project's brain configuration
import { createBrain } from '@positronic/core';
import { components } from './components/index.js';
import slack from './services/slack.js';
import gmail from './services/gmail.js';

export const brain = createBrain({
  services: { slack, gmail },
  components,
});
```

Now all brains in your project have type-safe access to services:

```typescript
// brains/my-brain.ts
import { brain } from '../brain.js';

// Builder pattern - services available in steps
export default brain('my-workflow')
  .step('Notify', ({ slack }) => {
    slack.postMessage('#alerts', 'Workflow started');
    return { notified: true };
  });

// Direct agent creation - services available in config function
export default brain('my-agent', ({ slack, env }) => ({
  system: 'You are a helpful assistant',
  prompt: 'Help the user',
  tools: {
    notify: {
      description: 'Send a Slack message',
      inputSchema: z.object({ message: z.string() }),
      execute: ({ message }) => slack.postMessage('#general', message),
    },
    done: {
      description: 'Complete the task',
      inputSchema: z.object({ result: z.string() }),
      terminal: true,
    },
  },
}));
```

## Creating Agents with `brain()`

The `brain()` function supports creating standalone agents directly, without needing to chain steps. This is useful when your entire brain is just a single agent.

### Direct Agent with Config Object

Create an agent by passing a config object as the second argument:

```typescript
import { brain } from '@positronic/core';
import { z } from 'zod';

const myAgent = brain('math-helper', {
  system: 'You are a helpful math tutor.',
  prompt: 'Help the user solve their math problem.',
  tools: {
    calculate: {
      description: 'Perform a calculation',
      inputSchema: z.object({
        expression: z.string(),
      }),
      execute: ({ expression }) => eval(expression),
    },
    submitAnswer: {
      description: 'Submit the final answer',
      inputSchema: z.object({
        answer: z.number(),
        explanation: z.string(),
      }),
      terminal: true,
    },
  },
});
```

This is equivalent to:

```typescript
brain('math-helper')
  .brain('main', {
    system: '...',
    prompt: '...',
    tools: { ... },
  })
```

### Direct Agent with Config Function

For dynamic configuration, pass a function:

```typescript
import { brain, defaultTools } from '@positronic/core';
import { z } from 'zod';

const dynamicAgent = brain('dynamic-helper', ({ tools }) => ({
  system: 'You are a helpful assistant.',
  prompt: 'Help the user with their request.',
  tools: {
    ...tools, // Include default tools
    customTool: {
      description: 'A custom tool',
      inputSchema: z.object({ input: z.string() }),
      execute: ({ input }) => `Processed: ${input}`,
    },
    done: {
      description: 'Complete the task',
      inputSchema: z.object({ result: z.string() }),
      terminal: true,
    },
  },
}));
```

### When to Use Direct Agent Creation

Use `brain('name', config)` when:
- Your brain is a single agent with no other steps
- You want a concise way to define a standalone agent
- The agent doesn't need initialization steps before running

Use the builder pattern `brain('name').step(...).brain(...)` when:
- You need multiple steps before or after the agent
- You need to set up state before the agent runs
- You have multiple agents in sequence

## The `.brain()` Step Method

The `.brain()` method has three overloaded forms for different use cases:

### Form 1: Nested Brain (Existing Behavior)

Run another brain as a sub-workflow:

```typescript
import { brain } from '@positronic/core';

const innerBrain = brain('process-item')
  .step('Process', ({ state }) => ({ processed: true }));

const outerBrain = brain('orchestrator')
  .step('Init', () => ({ items: ['a', 'b', 'c'] }))
  .brain(
    'Run Inner',
    innerBrain,
    ({ state, brainState }) => ({
      ...state,
      result: brainState.processed,
    }),
    (state) => ({ item: state.items[0] }) // Initial state for inner brain
  );
```

### Form 2: Inline Agent with Config Object

Create an agent with a static configuration:

```typescript
import { brain } from '@positronic/core';
import { z } from 'zod';

const myBrain = brain('simple-agent')
  .step('Init', () => ({ question: 'What is 2+2?' }))
  .brain('Answer', {
    system: 'You are a helpful math tutor.',
    prompt: 'Please answer the question.',
    tools: {
      calculateSum: {
        description: 'Add two numbers together',
        inputSchema: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: ({ a, b }) => a + b,
      },
      submitAnswer: {
        description: 'Submit the final answer',
        inputSchema: z.object({
          answer: z.number(),
        }),
        terminal: true,
      },
    },
  });
```

### Form 3: Inline Agent with Config Function

Create an agent with dynamic configuration based on state:

```typescript
import { brain } from '@positronic/core';
import { z } from 'zod';

const myBrain = brain('dynamic-agent')
  .step('Init', () => ({ userName: 'Alice', task: 'summarize document' }))
  .brain('Process', ({ state, tools }) => ({
    system: `You are helping ${state.userName} with their request.`,
    prompt: `Please ${state.task}.`,
    tools: {
      ...tools, // Include default tools
      customTool: {
        description: 'A custom tool for this step',
        inputSchema: z.object({ input: z.string() }),
        execute: ({ input }) => `Processed: ${input}`,
      },
    },
  }));
```

## Agent Configuration

The `AgentConfig` interface defines what an agent needs:

```typescript
interface AgentConfig<TTools> {
  /** System prompt for the LLM */
  system?: string;

  /** Initial user prompt to start the conversation */
  prompt: string;

  /** Tools available to the LLM. Optional - merged with withTools defaults */
  tools?: TTools;

  /** Safety valve - exit if cumulative tokens exceed this limit */
  maxTokens?: number;
}
```

## Defining Tools

Tools are defined using the `AgentTool` interface:

```typescript
interface AgentTool<TInput extends z.ZodSchema> {
  /** Description of what this tool does - helps the LLM understand when to use it */
  description: string;

  /** Zod schema defining the input parameters */
  inputSchema: TInput;

  /** Execute function. Can return a result or { waitFor: webhook } to suspend */
  execute?: (input: z.infer<TInput>) =>
    | unknown
    | Promise<unknown>
    | AgentToolWaitFor
    | Promise<AgentToolWaitFor>;

  /** If true, calling this tool ends the agent. Input becomes the result */
  terminal?: boolean;
}
```

### Regular Tools

Tools that perform actions and return results:

```typescript
const searchTool: AgentTool = {
  description: 'Search for documents in the database',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    limit: z.number().optional().describe('Max results to return'),
  }),
  execute: async ({ query, limit = 10 }) => {
    const results = await database.search(query, limit);
    return results;
  },
};
```

### Terminal Tools

Tools that end the agent when called:

```typescript
const submitResult: AgentTool = {
  description: 'Submit the final result and complete the task',
  inputSchema: z.object({
    summary: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  terminal: true,
  // No execute needed - input schema defines the result shape
};
```

### Webhook Tools (Suspend/Resume)

Tools that pause execution and wait for external events:

```typescript
import { createWebhook } from '@positronic/core';

const approvalWebhook = createWebhook(
  'approval',
  z.object({
    approved: z.boolean(),
    approverEmail: z.string().email(),
    notes: z.string().optional(),
  }),
  async () => ({ type: 'webhook', identifier: 'pending', response: {} })
);

const requestApproval: AgentTool = {
  description: 'Request approval from a human before proceeding',
  inputSchema: z.object({
    action: z.string().describe('What action needs approval'),
    urgency: z.enum(['low', 'medium', 'high']),
  }),
  execute: ({ action, urgency }) => {
    // Send notification, then wait for webhook
    return {
      waitFor: approvalWebhook('pending-approval-id'),
    };
  },
};
```

## Default Tools with `withTools()`

Configure default tools that are available to all agent steps:

```typescript
import { brain, defaultTools } from '@positronic/core';

const myBrain = brain('with-defaults')
  .withTools(defaultTools)
  .brain('Agent Step', ({ state, tools }) => ({
    system: 'You are helpful.',
    prompt: 'Help the user.',
    tools, // Uses defaultTools
  }));
```

### Extending Default Tools

Add custom tools while keeping defaults:

```typescript
.brain('Extended Agent', ({ state, tools }) => ({
  system: 'You have access to standard and custom tools.',
  prompt: 'Complete the task.',
  tools: {
    ...tools, // Spread defaults
    myCustomTool: {
      description: 'A custom tool',
      inputSchema: z.object({ data: z.string() }),
      execute: ({ data }) => processData(data),
    },
  },
}))
```

### Overriding Default Tools

Replace a default tool with a custom implementation:

```typescript
.brain('Override Agent', ({ tools }) => ({
  system: 'Custom generateUI behavior.',
  prompt: 'Generate UI.',
  tools: {
    ...tools,
    generateUI: {
      ...tools.generateUI,
      execute: (input) => {
        // Custom logic here
        return myCustomUIHandler(input);
      },
    },
  },
}))
```

## The `generateUI` Default Tool

The `generateUI` tool allows agents to create interactive UI and wait for user responses:

```typescript
import { brain, defaultTools } from '@positronic/core';

const uiBrain = brain('interactive')
  .withTools(defaultTools)
  .withComponents(myComponents) // Required for generateUI
  .brain('Ask User', ({ tools, components }) => ({
    system: 'You can generate forms to collect user input.',
    prompt: 'Ask the user for their preferences.',
    tools, // includes generateUI
  }));
```

When the agent calls `generateUI`, execution suspends until the user submits the form.

## Agent Events

Agent steps emit events during execution for monitoring and debugging:

| Event | Description |
|-------|-------------|
| `AGENT_START` | Agent execution begins |
| `AGENT_ITERATION` | New iteration of the agent loop |
| `AGENT_TOOL_CALL` | Agent is calling a tool |
| `AGENT_TOOL_RESULT` | Tool execution completed |
| `AGENT_ASSISTANT_MESSAGE` | LLM generated a message |
| `AGENT_WEBHOOK` | Agent suspended waiting for webhook |
| `AGENT_COMPLETE` | Agent finished (terminal tool called) |
| `AGENT_TOKEN_LIMIT` | Agent stopped due to token limit |

### Listening to Events

```typescript
import { BRAIN_EVENTS } from '@positronic/core';

for await (const event of brain.run({ client })) {
  switch (event.type) {
    case BRAIN_EVENTS.AGENT_START:
      console.log('Agent started:', event.title);
      break;
    case BRAIN_EVENTS.AGENT_TOOL_CALL:
      console.log('Tool called:', event.name, event.input);
      break;
    case BRAIN_EVENTS.AGENT_COMPLETE:
      console.log('Agent completed with result:', event.result);
      break;
  }
}
```

## Type Safety

### Extracting Terminal Tool Input Type

The `ExtractTerminalInput` helper type extracts the result type from terminal tools:

```typescript
import type { AgentTool, ExtractTerminalInput } from '@positronic/core';

const myTools = {
  search: { /* ... */ } as AgentTool,
  submit: {
    description: 'Submit result',
    inputSchema: z.object({
      answer: z.string(),
      confidence: z.number(),
    }),
    terminal: true,
  } as AgentTool,
};

// Type is { answer: string; confidence: number }
type Result = ExtractTerminalInput<typeof myTools>;
```

### Config Function Parameters

The config function receives typed parameters:

```typescript
.brain('Typed Agent', ({
  state,      // Current brain state
  options,    // Brain options (from withOptionsSchema)
  tools,      // Default tools (from withTools)
  components, // UI components (from withComponents)
  client,     // ObjectGenerator for LLM calls
  resources,  // Resource loader
  response,   // Webhook response (if resuming)
  page,       // Generated page (from .ui() step)
  pages,      // Pages service
  env,        // Runtime environment
  ...services // Custom services (from withServices)
}) => ({
  system: '...',
  prompt: '...',
}))
```

## Complete Example

```typescript
import { brain, defaultTools, createWebhook } from '@positronic/core';
import { z } from 'zod';

// Define a webhook for human approval
const approvalWebhook = createWebhook(
  'escalation-approval',
  z.object({
    approved: z.boolean(),
    reason: z.string().optional(),
  }),
  async () => ({ type: 'webhook', identifier: 'pending', response: {} })
);

// Define the brain
const supportAgent = brain('support-agent')
  .withOptionsSchema(z.object({
    maxIterations: z.number().default(10),
  }))
  .withTools(defaultTools)
  .step('Initialize', () => ({
    ticketId: 'TICKET-123',
    customerName: 'Alice',
    issue: 'Cannot login to account',
  }))
  .brain('Handle Ticket', ({ state, tools, options }) => ({
    system: `You are a support agent handling ticket ${state.ticketId}.
The customer is ${state.customerName}.
You have ${options.maxIterations} iterations to resolve this.`,
    prompt: `Customer issue: ${state.issue}

Please investigate and resolve this issue. If you need to perform
any sensitive actions, request approval first.`,
    tools: {
      ...tools,

      lookupAccount: {
        description: 'Look up customer account details',
        inputSchema: z.object({
          customerId: z.string(),
        }),
        execute: async ({ customerId }) => {
          // Simulate account lookup
          return { status: 'locked', lastLogin: '2024-01-15' };
        },
      },

      requestApproval: {
        description: 'Request human approval for sensitive actions',
        inputSchema: z.object({
          action: z.string(),
          reason: z.string(),
        }),
        execute: ({ action, reason }) => ({
          waitFor: approvalWebhook('approval-' + Date.now()),
        }),
      },

      unlockAccount: {
        description: 'Unlock a locked customer account',
        inputSchema: z.object({
          customerId: z.string(),
          reason: z.string(),
        }),
        execute: async ({ customerId, reason }) => {
          // Perform unlock
          return { success: true };
        },
      },

      resolveTicket: {
        description: 'Mark the ticket as resolved',
        inputSchema: z.object({
          resolution: z.string(),
          followUpRequired: z.boolean(),
        }),
        terminal: true,
      },
    },
    maxTokens: 50000,
  }))
  .step('Log Resolution', ({ state }) => {
    console.log('Ticket resolved:', state);
    return state;
  });

// Run the brain
const runner = new BrainRunner({ client: myClient, adapters: [] });
const finalState = await runner.run(supportAgent);
```

## Best Practices

1. **Keep tools focused**: Each tool should do one thing well.

2. **Use terminal tools**: Always define a terminal tool to give the agent a clear way to complete its task.

3. **Set token limits**: Use `maxTokens` to prevent runaway agents.

4. **Provide clear descriptions**: Tool descriptions help the LLM understand when and how to use them.

5. **Handle webhooks properly**: When using webhook tools, ensure your system can route webhook responses back to the suspended brain.

6. **Use default tools**: The `defaultTools` export provides commonly needed functionality like `generateUI`.

7. **Type your tools**: Use Zod schemas to ensure type safety for tool inputs and outputs.
