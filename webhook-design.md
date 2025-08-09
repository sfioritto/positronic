# Webhook Design for Positronic

This document outlines the webhook system design for Positronic, enabling brains to pause execution and wait for external events.

## Overview

Webhooks in Positronic allow brains to:
1. Pause execution and wait for external events (e.g., user responses via Slack, SMS, email)
2. Start new brain runs from incoming webhook requests
3. Maintain type safety throughout the entire flow

## Developer Experience

### Creating a Webhook

Webhooks are defined as classes in the `webhooks/` directory:

```typescript
// webhooks/slack.ts
import { Webhook } from '@positronic/core';
import { z } from 'zod';

export default class SlackWebhook extends Webhook {
  // Static schema for type inference
  static responseSchema = z.object({
    message: z.string(),
    userId: z.string(),
    channelId: z.string(),
    threadId: z.string(),
  });

  constructor() {
    super({
      slug: 'slack', // Results in URL: /webhooks/slack
      description: 'Handles Slack interactive messages and slash commands',
      schema: SlackWebhook.responseSchema,
    });
  }

  async handler(request: Request) {
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
}
```

### Using Webhooks in Brains

#### Waiting for External Events

```typescript
import { brain } from '@positronic/core';
import { SlackWebhook, TwilioWebhook } from '@positronic/webhooks'; // Auto-generated types!

export default brain('customer-feedback')
  .step('AskForFeedback', async ({ state }) => {
    // Send messages to multiple channels
    const slackRes = await sendSlackMessage(state.customer.slackChannel);
    const threadId = slackRes.ts;
    
    await sendTwilioSMS(state.customer.phoneNumber);
    
    // Wait for response from EITHER channel
    return {
      state: { ...state, slackThreadId: threadId },
      webhook: {
        slack: SlackWebhook.respondsTo(threadId),
        twilio: TwilioWebhook.respondsTo(state.customer.phoneNumber),
      }
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

```typescript
// webhooks/github.ts
export default class GitHubWebhook extends Webhook {
  static responseSchema = z.object({
    action: z.string(),
    prNumber: z.number(),
    repository: z.string(),
    author: z.string(),
  });

  async handler(request: Request) {
    const body = await request.json();
    
    // Handler can return both brain and identifier
    // Framework will:
    // 1. Start new brain if no matching identifier found
    // 2. Resume existing brain if identifier matches
    // 3. Always pass response as initial state or resume data
    return {
      brain: 'pr-review' as const, // TypeScript validates via generated types
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
}
```

### Loop Integration

Loops support two webhook patterns:

#### 1. Explicit Waiting via Tool

```typescript
brain('support-agent')
  .loop('HandleCustomer', {
    tools: [
      {
        name: 'wait_for_response',
        description: 'Stop and wait for customer response',
        parameters: z.object({
          reason: z.string(),
          webhooks: z.object({
            slack: z.string().optional(),
            twilio: z.string().optional(),
            email: z.string().optional(),
          })
        }),
        execute: async ({ reason, webhooks }) => {
          // Return same format as step returns
          const webhookConfig: any = {};
          if (webhooks.slack) {
            webhookConfig.slack = SlackWebhook.respondsTo(webhooks.slack);
          }
          if (webhooks.twilio) {
            webhookConfig.twilio = TwilioWebhook.respondsTo(webhooks.twilio);
          }
          if (webhooks.email) {
            webhookConfig.email = EmailWebhook.respondsTo(webhooks.email);
          }
          
          return {
            state: { waitingReason: reason },
            webhook: webhookConfig
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

#### 2. Persistent Webhooks (Messages Between Iterations)

```typescript
brain('chat-assistant')
  .withOptionsSchema(z.object({
    sessionId: z.string(),
  }))
  .loop('Chat', {
    // Always listening, can inject messages anytime
    persistentWebhooks: ({ options }) => ({
      chat: ChatWebhook.respondsTo(options.sessionId)
    }),
    
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

### Why Classes Instead of Builder Pattern?

While brains use a builder pattern due to their complex chaining and type inference needs, webhooks are simpler:
- Single responsibility: transform incoming requests
- No complex type chaining between methods
- Clear, simple interface that's easy to test

### Why Enforce Unique Slugs?

Each webhook class must have a unique slug for its URL path:
- Ensures predictable 1:1 mapping between URLs and handlers
- Avoids routing ambiguity - `/webhooks/slack` maps to exactly one handler
- Enables compile-time validation during type generation
- Matches standard webhook patterns (one endpoint per integration)

The CLI will error during type generation if duplicate slugs are detected.

### Why Static Response Schema?

The response schema is defined as a static property because:
- It's not instance-specific - all webhook instances of a class share the same response type
- Enables `respondsTo()` factory method to access the type without instantiation
- Allows TypeScript to infer union types when multiple webhooks are used

### Why Factory Method `respondsTo()`?

The static factory method pattern provides several benefits:
- Clean, readable syntax: `SlackWebhook.respondsTo(threadId)`
- Returns typed object with both identifier and response type
- Enables proper TypeScript inference for union types in the next step

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
// One webhook class handles all Slack events
async handler(request: Request) {
  const event = await request.json();
  
  if (event.type === 'app_mention') {
    // New mention - start fresh brain
    return {
      brain: 'help-request' as const,
      response: { message: event.text, channel: event.channel }
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
```

This pattern is common across many services (GitHub PRs, support tickets, chat systems) where the same webhook endpoint handles both new and ongoing interactions.

### Type Safety Through Code Generation

The CLI watches both `webhooks/` and `brains/` directories to generate type definitions:

**Generated webhooks.d.ts**:
```typescript
// Auto-generated webhook exports
declare module '@positronic/webhooks' {
  import type { default as SlackWebhookClass } from './webhooks/slack.js';
  import type { default as TwilioWebhookClass } from './webhooks/twilio.js';
  import type { default as GitHubWebhookClass } from './webhooks/github.js';
  
  export const SlackWebhook: typeof SlackWebhookClass;
  export const TwilioWebhook: typeof TwilioWebhookClass;
  export const GitHubWebhook: typeof GitHubWebhookClass;
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

1. **Webhook Registration**: When a brain returns webhook objects, the framework registers `(webhook_name, identifier, brain_run_id)` tuples

2. **Request Routing**: Incoming requests to `/webhooks/{name}` are routed to the appropriate webhook handler

3. **Handler Processing**: The webhook handler extracts the identifier and builds the typed response

4. **Brain Resume/Start**:
   - If `identifier` is returned: Look up brain run ID and resume with response
   - If `brain` is returned: Start new brain run with response as initial state

5. **Cleanup**: When brains complete or error, webhook registrations are removed

### Loop Implementation Details

#### Events and State Management

Loops will emit their own events similar to steps:
- `LOOP_START` - When loop begins
- `LOOP_ITERATION` - Each iteration with patches
- `LOOP_COMPLETE` - When loop exits
- `LOOP_MESSAGE` - When persistent webhook delivers a message

Each loop iteration creates patches, allowing full state reconstruction.

#### Webhook Differentiation

To handle both explicit waits and persistent webhooks:

1. **Explicit Wait (Tool-triggered)**:
   - Tool returns webhook configuration
   - Loop emits `WEBHOOK` event, pausing execution
   - Webhook response resumes loop with response in context

2. **Persistent Webhooks**:
   - Registered when loop starts with a special flag
   - Adapter listens for these continuously
   - Messages delivered via generator's `send()` method
   - Loop checks for injected messages before each iteration

```typescript
// In the loop execution
async *executeLoop() {
  // Register persistent webhooks
  for (const [name, webhook] of Object.entries(persistentWebhooks)) {
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

The adapter differentiates by checking the registration type:
- Persistent webhooks → Use `generator.send(message)`
- Explicit wait webhooks → Resume brain run normally

## Benefits

1. **Type Safety**: Full TypeScript inference from webhook definition to brain response
2. **Flexibility**: Support for both resuming existing runs and starting new ones
3. **Service Agnostic**: Each webhook handles its own request format and identifier extraction
4. **Clean DX**: Simple class-based API with clear responsibilities
5. **Extensible**: Easy to add new webhook types without framework changes

## Future Considerations

- **Webhook Timeouts**: Add configurable timeouts for webhook waits
- **Multiple Response Handling**: Support webhooks that can fire multiple times
- **Webhook Middleware**: Add authentication, rate limiting, etc.
- **MCP Integration**: Extend to support Model Context Protocol servers