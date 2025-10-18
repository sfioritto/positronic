# Webhook Design for Positronic

This document outlines the webhook system design for Positronic, enabling brains to pause execution and wait for external events.

## Overview

Webhooks in Positronic allow brains to:
1. Pause execution and wait for external events (e.g., user responses via Slack, SMS, email)
2. Start new brain runs from incoming webhook requests
3. Maintain type safety throughout the entire flow

## Developer Experience

### Creating a Webhook

Webhooks are created using the `createWebhook()` factory function:

```typescript
// webhooks/slack.ts
import { createWebhook } from '@positronic/core';
import { z } from 'zod';

export const slackWebhook = createWebhook(
  'slack', // Results in URL: /webhooks/slack
  z.object({
    message: z.string(),
    userId: z.string(),
    channelId: z.string(),
    threadId: z.string(),
  }),
  async (request: Request) => {
    const body = await request.json();

    // Return identifier for resuming brains OR brain name for cold starts
    return {
      identifier: body.thread_ts, // Used to match waiting brain runs
      response: {
        message: body.text,
        userId: body.user,
        channelId: body.channel,
        threadId: body.thread_ts,
      }
    };
  }
);
```

> **Note**: The `description` field is planned for future implementation to provide human-readable webhook documentation in CLI commands.

### Using Webhooks in Brains

#### Waiting for External Events

```typescript
import { brain } from '@positronic/core';
import { slackWebhook, twilioWebhook } from './webhooks/index.js';

export default brain('customer-feedback')
  .step('AskForFeedback', async ({ state }) => {
    // Send messages to multiple channels
    const slackRes = await sendSlackMessage(state.customer.slackChannel);
    const threadId = slackRes.ts;

    await sendTwilioSMS(state.customer.phoneNumber);

    // Wait for response from EITHER channel
    return {
      state: { ...state, slackThreadId: threadId },
      waitFor: [
        slackWebhook(threadId),
        twilioWebhook(state.customer.phoneNumber),
      ]
    };
  })
  .step('ProcessFeedback', async ({ state, response }) => {
    // TypeScript knows response is a union type!
    if ('threadId' in response) {
      // Slack response
      return { ...state, feedback: response.message, source: 'slack' };
    } else {
      // Twilio response
      return { ...state, feedback: response.message, source: 'sms' };
    }
  });
```

#### Starting New Brain Runs

> **Note**: The `brain` field for cold-starting brains from webhooks is planned but not yet implemented.

```typescript
// webhooks/github.ts
import { createWebhook } from '@positronic/core';
import { z } from 'zod';

export const githubWebhook = createWebhook(
  'github',
  z.object({
    action: z.string(),
    prNumber: z.number(),
    repository: z.string(),
    author: z.string(),
  }),
  async (request: Request) => {
    const body = await request.json();

    // Handler can return both brain and identifier
    // Framework will:
    // 1. Start new brain if no matching identifier found
    // 2. Resume existing brain if identifier matches
    // 3. Always pass response as initial state or resume data
    return {
      brain: 'pr-review' as const, // PLANNED: TypeScript validates via generated types
      identifier: body.pull_request ?
        `${body.repository.full_name}#${body.pull_request.number}` :
        undefined,
      response: {
        action: body.action,
        prNumber: body.pull_request?.number,
        repository: body.repository.full_name,
        author: body.pull_request?.user.login || body.sender.login,
      }
    };
  }
);
```

### Loop Integration

> **Note**: Loop integration with webhooks is planned for future implementation. This section describes the planned design.

Loops can support explicit waiting for webhooks via tools:

#### Explicit Waiting via Tool

```typescript
brain('support-agent')
  .loop('HandleCustomer', {
    tools: [
      {
        name: 'wait_for_response',
        description: 'Stop and wait for customer response',
        parameters: z.object({
          reason: z.string(),
          identifiers: z.object({
            slack: z.string().optional(),
            twilio: z.string().optional(),
            email: z.string().optional(),
          })
        }),
        execute: async ({ reason, identifiers }) => {
          // Return same format as step returns
          const waitList: any[] = [];
          if (identifiers.slack) {
            waitList.push(slackWebhook(identifiers.slack));
          }
          if (identifiers.twilio) {
            waitList.push(twilioWebhook(identifiers.twilio));
          }
          if (identifiers.email) {
            waitList.push(emailWebhook(identifiers.email));
          }

          return {
            state: { waitingReason: reason },
            waitFor: waitList
          };
        }
      }
    ],
    prompt: ({ response }) => {
      if (response) {
        return `Customer said: "${response.message}"`;
      }
      return 'Help the customer...';
    }
  });
```

### CLI Integration

```bash
$ px webhooks list

Available Webhooks:
┌─────────┬────────────────────────────────────────────────┬─────────────────────────────────────┐
│ Name    │ URL                                            │ Description                         │
├─────────┼────────────────────────────────────────────────┼─────────────────────────────────────┤
│ slack   │ https://your-app.workers.dev/webhooks/slack   │ Handles Slack interactive messages  │
│ twilio  │ https://your-app.workers.dev/webhooks/twilio  │ Handles incoming SMS messages       │
│ github  │ https://your-app.workers.dev/webhooks/github  │ Handles GitHub webhooks for PR...   │
└─────────┴────────────────────────────────────────────────┴─────────────────────────────────────┘
```

## Design Decisions

### Why Factory Functions?

Webhooks use the `createWebhook()` factory function pattern for several reasons:
- **Type Inference**: TypeScript can properly infer the Zod schema type and flow it through to the response type in brain steps
- **Simplicity**: Single function call creates a complete webhook with handler, schema, and metadata
- **Functional Style**: Webhooks are immutable values that can be easily composed and reused
- **Attached Metadata**: The handler, slug, and schema are attached to the function itself, making them accessible to the backend routing system

### Why Array Instead of Named Object for `waitFor`?

The `waitFor` field accepts an array rather than a named object:
- **Simplicity**: Just a list of things to wait for, no need to name each one
- **Flexibility**: Can wait for multiple webhooks of the same type with different identifiers
- **Extensibility**: Makes it easier to support waiting for non-webhook events in the future (timeouts, scheduled events, etc.)
- **Type Inference**: Array pattern works better with TypeScript's union type extraction

### Why Enforce Unique Slugs?

Each webhook must have a unique slug for its URL path:
- Ensures predictable 1:1 mapping between URLs and handlers
- Avoids routing ambiguity - `/webhooks/slack` maps to exactly one handler
- Enables compile-time validation during type generation (planned)
- Matches standard webhook patterns (one endpoint per integration)

The CLI will error during type generation if duplicate slugs are detected (planned feature).

### Why Separate `identifier` and `response`?

This separation allows:
- Service-specific identifiers (thread IDs, phone numbers, PR numbers)
- Clean mapping between incoming events and waiting brain runs
- Flexibility for webhooks to handle both resume and cold-start scenarios

### Why Allow Both `brain` and `identifier` Together?

Real-world webhooks often need to handle both patterns with the same logic:

**Example: Slack DM Bot**
- `@bot help` in a channel → Start new 'help-request' brain
- User responds in existing thread → Resume waiting brain
- Direct message to bot → Start new 'dm-conversation' brain per user
- Follow-up DM from same user → Resume that user's conversation brain

```typescript
// One webhook handles all Slack events
export const slackWebhook = createWebhook(
  'slack',
  z.object({
    message: z.string(),
    user: z.string(),
    channel: z.string().optional(),
  }),
  async (request: Request) => {
    const event = await request.json();

    if (event.type === 'app_mention') {
      // New mention - start fresh brain
      return {
        brain: 'help-request' as const,
        response: { message: event.text, channel: event.channel, user: event.user }
      };
    } else if (event.type === 'message' && event.thread_ts) {
      // Thread reply - resume if brain waiting, otherwise start new
      return {
        brain: 'thread-handler' as const,
        identifier: event.thread_ts,
        response: { message: event.text, user: event.user }
      };
    } else if (event.type === 'message' && event.channel_type === 'im') {
      // DM - one continuous brain per user
      return {
        brain: 'dm-conversation' as const,
        identifier: `dm-${event.user}`,
        response: { message: event.text, user: event.user }
      };
    }
  }
);
```

This pattern is common across many services (GitHub PRs, support tickets, chat systems) where the same webhook endpoint handles both new and ongoing interactions.

### Type Safety Through Code Generation

> **Note**: Auto-generation of webhook types is planned for future implementation. This section describes the planned design.

The CLI watches both `webhooks/` and `brains/` directories to generate type definitions:

**Generated webhooks.d.ts**:
```typescript
// Auto-generated webhook exports
declare module '@positronic/webhooks' {
  export { slackWebhook } from './webhooks/slack.js';
  export { twilioWebhook } from './webhooks/twilio.js';
  export { githubWebhook } from './webhooks/github.js';
}

// Available brain names for type checking
declare module '@positronic/core' {
  interface AvailableBrains {
    'customer-feedback': true;
    'pr-review': true;
    'chat-assistant': true;
    'support-agent': true;
  }

  // This allows webhook handlers to use validated brain names
  export type BrainName = keyof AvailableBrains;
}
```

This provides:
1. Import safety - Can't import webhooks that don't exist
2. Brain name validation - Can't reference non-existent brains in handlers
3. Compile-time errors when files are deleted but still referenced
4. Consistent with the resources pattern developers already know

**Build-time validation**:
```bash
$ px webhooks list
Error: Duplicate webhook slug detected!
  - webhooks/slack.ts uses slug 'slack'
  - webhooks/slack-events.ts uses slug 'slack'
  
Each webhook must have a unique slug for its URL path.
```

## Implementation Flow

### Basic Webhook Flow

1. **Webhook Registration**: When a brain returns `waitFor` with webhook registrations, the framework stores `(slug, identifier, brain_run_id)` tuples

2. **Request Routing**: Incoming requests to `/webhooks/{slug}` are routed to the appropriate webhook handler

3. **Handler Processing**: The webhook handler extracts the identifier and builds the typed response

4. **Brain Resume/Start**:
   - If `identifier` is returned: Look up brain run ID and resume with response
   - If `brain` is returned (planned): Start new brain run with response as initial state

5. **Cleanup**: When brains complete or error, webhook registrations are removed

### Loop Implementation Details

Loops will emit their own events similar to steps:
- `LOOP_START` - When loop begins
- `LOOP_ITERATION` - Each iteration with patches
- `LOOP_COMPLETE` - When loop exits

Each loop iteration creates patches, allowing full state reconstruction.

When a loop tool returns `waitFor`, the loop emits a `WEBHOOK` event and pauses execution. The webhook response resumes the loop with the response available in context.

## Benefits

1. **Type Safety**: Full TypeScript inference from webhook definition to brain response
2. **Flexibility**: Support for both resuming existing runs and starting new ones (cold-start planned)
3. **Service Agnostic**: Each webhook handles its own request format and identifier extraction
4. **Clean DX**: Simple factory function API with minimal boilerplate
5. **Extensible**: Easy to add new webhook types without framework changes
6. **Generic Waiting**: The `waitFor` pattern can extend beyond webhooks to other async events

## Future Considerations

- **Webhook Timeouts**: Add configurable timeouts for webhook waits
- **Multiple Response Handling**: Support webhooks that can fire multiple times
- **Webhook Middleware**: Add authentication, rate limiting, etc.
- **MCP Integration**: Extend to support Model Context Protocol servers

---

## Good Idea Fairies

These are interesting ideas that might be useful someday, but aren't current priorities.

### Persistent Webhooks (Messages Between Loop Iterations)

The concept of persistent webhooks that can inject messages into running loops at any time, without explicitly waiting.

**Example use case:**
```typescript
brain('chat-assistant')
  .withOptionsSchema(z.object({
    sessionId: z.string(),
  }))
  .loop('Chat', {
    // Always listening, can inject messages anytime
    persistentWaitFor: ({ options }) => [
      chatWebhook(options.sessionId)
    ],

    tools: [searchWeb, calculate],

    prompt: ({ messages }) => {
      // messages includes both tool responses and webhook messages
      const lastMessage = messages[messages.length - 1];
      return lastMessage?.content || 'Waiting for user...';
    },

    onMessage: ({ message, state }) => ({
      ...state,
      history: [...state.history, message]
    })
  });
```

**Implementation approach:**
- Registered when loop starts with a special flag
- Adapter listens for these continuously
- Messages delivered via generator's `send()` method
- Loop checks for injected messages before each iteration

```typescript
// In the loop execution
async *executeLoop() {
  // Register persistent webhooks
  for (const webhook of persistentWaitFor) {
    await registerWebhook(webhook, brainRunId, { persistent: true });
  }

  while (condition) {
    // Check for injected messages
    const injectedMessage = yield; // Can receive value via generator.send()
    if (injectedMessage) {
      yield { type: 'LOOP_MESSAGE', message: injectedMessage };
      state = onMessage({ message: injectedMessage, state });
    }

    // Normal iteration...
  }
}
```

**Additional events needed:**
- `LOOP_MESSAGE` - When persistent webhook delivers a message

The adapter would differentiate by checking the registration type:
- Persistent webhooks → Use `generator.send(message)`
- Explicit wait webhooks → Resume brain run normally