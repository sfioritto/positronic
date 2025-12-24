# Loop Step Design for Positronic

This document explores the DSL design for adding "loop" steps (agentic loops) to Positronic brains.

## Design Goals

1. **Function-based config** - Like normal steps, a function that receives injected dependencies and returns configuration
2. **Simple and consistent** - Fits naturally with existing `.step()`, `.prompt()`, `.brain()` patterns
3. **Flexible tools** - System prompt, allowed tools, skills, sub-brains
4. **Wait capability** - Loop can pause for webhooks (controlled via tool calls)
5. **Brain injection** - Access to all project brains for delegation

---

## Core Concept: The Config Function Pattern

Just like `.step()` receives `{ state, client, resources, options, ...services }`, the loop step receives the same context **plus project-level dependencies** and returns a configuration object:

```typescript
.loop('Agent Name', ({ state, options, resources, brains, webhooks }) => ({
  // Config returned here
}))
```

The function pattern allows:
- Conditional configuration based on state/options
- Type-safe access to injected brains
- Dynamic tool selection based on context

---

## DSL Option 1: Minimal Config Object

The simplest approach - just the essentials:

```typescript
import { brain } from '../brain.js';
import { slackWebhook, emailWebhook } from './webhooks/index.js';
import subTaskBrain from './sub-task.js';

export default brain('Support Agent')
  .step('Load Context', async ({ state }) => ({
    customer: await fetchCustomer(state.customerId),
    history: await fetchHistory(state.customerId),
  }))
  .loop('Handle Request', ({ state, brains, webhooks }) => ({
    system: `You are a helpful support agent. Customer: ${state.customer.name}`,

    tools: {
      search_knowledge_base: {
        description: 'Search our help docs',
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          return await searchKnowledgeBase(query);
        },
      },

      escalate_to_human: {
        description: 'Escalate this ticket to a human agent',
        parameters: z.object({ reason: z.string() }),
        execute: async ({ reason }) => ({ escalated: true, reason }),
        exit: true, // Exits the loop after this tool
      },

      wait_for_customer: {
        description: 'Wait for customer response',
        parameters: z.object({ message: z.string() }),
        execute: async ({ message }, { state }) => {
          await sendToCustomer(message, state.customer);
          return {
            state: { ...state, waitingForCustomer: true },
            waitFor: [
              webhooks.slack(state.customer.slackThreadId),
              webhooks.email(state.customer.email),
            ],
          };
        },
      },
    },

    // Delegate to sub-brains
    brains: {
      process_refund: brains.refundProcessor,
      update_subscription: brains.subscriptionManager,
    },
  }))
  .step('Wrap Up', ({ state }) => ({
    ...state,
    resolved: true,
    resolvedAt: new Date().toISOString(),
  }));
```

**Key aspects:**
- `system` - The system prompt for the agent
- `tools` - Object of tool definitions with `execute` functions
- `brains` - Sub-brains the agent can delegate to (exposed as tools)
- `exit: true` - Marks a tool that ends the loop
- `waitFor` return - Same pattern as step webhooks

---

## DSL Option 2: Builder Pattern for Tools

More explicit tool configuration with fluent builders:

```typescript
import { tool, exitTool, waitTool } from '@positronic/core';

export default brain('Support Agent')
  .loop('Handle Request', ({ state, brains, webhooks }) => ({
    system: `You are a support agent helping ${state.customer.name}`,

    tools: [
      tool('search_docs')
        .description('Search documentation')
        .parameters(z.object({ query: z.string() }))
        .execute(async ({ query }) => searchDocs(query)),

      tool('send_message')
        .description('Send message and wait for response')
        .parameters(z.object({ message: z.string() }))
        .waitFor(({ message }, { state }) => [
          webhooks.slack(state.threadId),
        ])
        .execute(async ({ message }) => {
          await sendMessage(message);
          return { messageSent: true };
        }),

      exitTool('resolve')
        .description('Mark the issue as resolved')
        .parameters(z.object({ summary: z.string() }))
        .execute(async ({ summary }) => ({ resolved: true, summary })),
    ],

    brains: [brains.refundProcessor, brains.billingHelper],
  }));
```

**Pros:**
- Clear distinction between regular/exit/wait tools
- Fluent API familiar to many developers
- `waitFor` can be a function that receives tool params

**Cons:**
- More verbose
- More concepts to learn

---

## DSL Option 3: Skills as First-Class Concept

If you want "skills" to be distinct from tools:

```typescript
export default brain('Support Agent')
  .loop('Handle Request', ({ state, brains }) => ({
    system: 'You are a helpful support agent.',

    // Tools are simple functions the model can call
    tools: {
      search_docs: {
        description: 'Search documentation',
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => searchDocs(query),
      },
    },

    // Skills are higher-level capabilities (could wrap brains, multi-step workflows)
    skills: {
      process_refund: {
        description: 'Handle a customer refund request end-to-end',
        brain: brains.refundProcessor,
        // Optional: transform state before/after
        prepareState: (state) => ({ orderId: state.currentOrder.id }),
        handleResult: (state, brainResult) => ({
          ...state,
          refundStatus: brainResult.status,
        }),
      },

      check_order_status: {
        description: 'Look up the status of a customer order',
        // Skills can also just be async functions
        execute: async ({ orderId }) => await fetchOrderStatus(orderId),
        parameters: z.object({ orderId: z.string() }),
      },
    },

    // Exit conditions
    exitOn: ['issue_resolved', 'escalated_to_human'],
  }));
```

**Key differences:**
- `skills` wrap more complex capabilities (brains or multi-step processes)
- `tools` are simple function calls
- `exitOn` lists tool names that exit the loop

---

## DSL Option 4: Declarative with "Modes"

For complex agents with different behavioral modes:

```typescript
export default brain('Support Agent')
  .loop('Handle Request', ({ state, brains, webhooks }) => ({
    system: 'You are a support agent.',

    // Initial mode
    mode: 'gathering_info',

    modes: {
      gathering_info: {
        prompt: 'First, understand the customer problem.',
        tools: ['ask_clarifying_question', 'search_history'],
        canTransitionTo: ['solving', 'escalating'],
      },
      solving: {
        prompt: 'Now solve the problem.',
        tools: ['search_docs', 'process_refund', 'update_account'],
        canTransitionTo: ['awaiting_response', 'resolved'],
      },
      awaiting_response: {
        prompt: 'Waiting for customer response.',
        waitFor: [webhooks.slack(state.threadId)],
        canTransitionTo: ['gathering_info', 'solving', 'resolved'],
      },
      resolved: {
        exit: true,
      },
    },

    tools: {
      ask_clarifying_question: { /* ... */ },
      search_history: { /* ... */ },
      search_docs: { /* ... */ },
      process_refund: { brain: brains.refundProcessor },
      update_account: { /* ... */ },
    },
  }));
```

**Note:** This adds complexity. Might be overkill for v1.

---

## DSL Option 5: Streamlined with Sensible Defaults (Recommended)

Balancing simplicity with power:

```typescript
import { brain } from '../brain.js';
import { z } from 'zod';

export default brain('Support Agent')
  .step('Initialize', async ({ state }) => ({
    customer: await fetchCustomer(state.customerId),
    conversationHistory: [],
  }))

  .loop('Chat', ({ state, options, brains, webhooks }) => ({
    // System prompt - the agent's persona and context
    system: `
      You are a friendly support agent for Acme Corp.
      Customer: ${state.customer.name}
      Account type: ${state.customer.tier}

      Be helpful, concise, and professional.
    `,

    // Tools the agent can use
    tools: {
      search_knowledge_base: {
        description: 'Search our help documentation',
        parameters: z.object({
          query: z.string().describe('Search query'),
        }),
        execute: async ({ query }) => {
          const results = await searchKB(query);
          return results.map(r => r.summary).join('\n');
        },
      },

      check_order_status: {
        description: 'Look up a customer order',
        parameters: z.object({
          orderId: z.string(),
        }),
        execute: async ({ orderId }) => {
          return await getOrderStatus(orderId);
        },
      },

      send_response: {
        description: 'Send a message to the customer and wait for their reply',
        parameters: z.object({
          message: z.string().describe('Message to send'),
        }),
        execute: async ({ message }, { state }) => {
          await sendSlackMessage(state.customer.slackThread, message);
          return { sent: true };
        },
        // This tool triggers a wait
        wait: ({ state }) => [
          webhooks.slack(state.customer.slackThread),
        ],
      },

      resolve_ticket: {
        description: 'Mark the support ticket as resolved',
        parameters: z.object({
          resolution: z.string().describe('Summary of how the issue was resolved'),
        }),
        execute: async ({ resolution }, { state }) => {
          await updateTicket(state.ticketId, { status: 'resolved', resolution });
          return { resolved: true };
        },
        // This tool exits the loop
        exit: true,
      },

      escalate: {
        description: 'Escalate to a human agent',
        parameters: z.object({
          reason: z.string(),
        }),
        execute: async ({ reason }, { state }) => {
          await escalateTicket(state.ticketId, reason);
          return { escalated: true };
        },
        exit: true,
      },
    },

    // Brains this agent can delegate to (exposed as tools automatically)
    brains: {
      process_refund: {
        brain: brains.refundProcessor,
        description: 'Process a refund for the customer',
        // Optional: map state in/out
        mapInput: (state) => ({ orderId: state.currentOrderId }),
        mapOutput: (state, result) => ({ ...state, refundResult: result }),
      },
    },

    // Optional: Max iterations before auto-exit (safety valve)
    maxIterations: 50,

    // Optional: What happens when max iterations reached
    onMaxIterations: 'exit', // or 'error'
  }))

  .step('Cleanup', ({ state }) => ({
    ...state,
    completedAt: new Date().toISOString(),
  }));
```

---

## Webhook Pattern for Loops

When a tool has `wait: true` or returns a `wait` function, the loop should:

1. Execute the tool
2. Emit a `LOOP_WAIT` event with the `waitFor` webhooks
3. Pause execution (persist state)
4. Resume when webhook fires, with `response` available

```typescript
// Inside a tool's execute function, you can also return waitFor directly:
execute: async ({ message }, { state, webhooks }) => {
  await sendMessage(message);
  return {
    toolResult: { sent: true },
    waitFor: [webhooks.slack(state.threadId)],
  };
}

// Or use the declarative `wait` property on the tool config:
wait: ({ state }) => [webhooks.slack(state.threadId)]
```

---

## Brain Injection Pattern

Brains from the project are injected into the loop config function:

```typescript
// In positronic.config.ts or similar
export const brains = {
  refundProcessor: refundBrain,
  subscriptionManager: subscriptionBrain,
  billingHelper: billingBrain,
};

// The loop receives these
.loop('Agent', ({ brains }) => ({
  brains: {
    refund: {
      brain: brains.refundProcessor, // Type-safe reference
      description: 'Process customer refunds',
    },
  },
}))
```

When a brain is used as a tool:
1. Agent calls `refund` tool with parameters
2. Loop starts a nested brain run
3. Result is returned to the agent as tool output
4. Agent continues with the result

---

## Events Emitted by Loops

```typescript
LOOP_START      // Loop begins
LOOP_ITERATION  // Each turn (with state patch)
LOOP_TOOL_CALL  // Tool was called
LOOP_TOOL_RESULT // Tool returned
LOOP_BRAIN_START // Nested brain started
LOOP_BRAIN_COMPLETE // Nested brain finished
LOOP_WAIT       // Waiting for webhook
LOOP_RESUME     // Resumed from webhook
LOOP_EXIT       // Loop finished (via exit tool)
LOOP_MAX_ITERATIONS // Hit max iterations
```

---

## Type Inference Considerations

The loop should maintain type safety:

```typescript
// State flows through
brain('Example')
  .step('Init', () => ({ count: 0, name: 'test' }))
  .loop('Process', ({ state }) => {
    // state is typed as { count: number; name: string }
    return {
      system: `Processing ${state.name}`,
      tools: { /* ... */ },
    };
  })
  .step('After', ({ state }) => {
    // state should include any mutations from the loop
    return state;
  });
```

Tools can modify state:

```typescript
tools: {
  increment: {
    description: 'Increment the counter',
    parameters: z.object({}),
    execute: async (_, { state }) => {
      return {
        toolResult: 'Incremented',
        state: { ...state, count: state.count + 1 },
      };
    },
  },
}
```

---

## Questions to Resolve

1. **Tool result vs state update**: Should tools return just a result (shown to model) or also update state? Proposed: Both via `{ toolResult, state? }` return.

2. **Brain-as-tool invocation**: When model calls a brain-tool, what parameters does it pass? Proposed: The brain's options schema becomes the tool parameters.

3. **Conversation history**: Should the loop maintain message history? Proposed: Yes, internally managed, but accessible if needed.

4. **Exit conditions**: What if model never calls exit tool? Proposed: `maxIterations` safety valve.

5. **Error handling**: What happens if a tool throws? Proposed: Error shown to model as tool result, loop continues.

---

## Recommended Approach: Option 5 with Progressive Disclosure

Start with the simplest possible loop:

```typescript
// Minimal loop - just system + tools
.loop('Agent', () => ({
  system: 'You are a helpful assistant.',
  tools: {
    search: {
      description: 'Search the web',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => search(query),
    },
    done: {
      description: 'Task complete',
      parameters: z.object({}),
      execute: async () => ({ done: true }),
      exit: true,
    },
  },
}))
```

Then add features as needed:
- `brains` - for delegation
- `wait` - for webhooks
- `maxIterations` - for safety
- State mutations via tool returns

This maintains the "simple things simple, complex things possible" philosophy.
