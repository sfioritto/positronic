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
    
    if (body.action === 'opened' && body.pull_request) {
      // Start a new brain run instead of resuming
      return {
        brain: 'pr-review', // Brain name to start
        response: {
          action: body.action,
          prNumber: body.pull_request.number,
          repository: body.repository.full_name,
          author: body.pull_request.user.login,
        }
      };
    }
    
    // Otherwise handle as resume
    return {
      identifier: `${body.repository.full_name}#${body.pull_request.number}`,
      response: { /* ... */ }
    };
  }
}
```

### Loop Integration

Loops can use webhooks through a special tool:

```typescript
brain('support-agent')
  .loop('HandleCustomer', {
    tools: [
      {
        name: 'wait_for_response',
        description: 'Wait for customer response on any channel',
        parameters: z.object({
          channels: z.array(z.enum(['slack', 'twilio', 'email'])),
        }),
        execute: async ({ channels }, { state }) => {
          return {
            _wait: true, // Special flag
            webhooks: {
              ...(channels.includes('slack') && {
                slack: SlackWebhook.respondsTo(state.slackThreadId)
              }),
              ...(channels.includes('twilio') && {
                twilio: TwilioWebhook.respondsTo(state.phoneNumber)
              }),
            }
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

### Why Classes Instead of Builder Pattern?

While brains use a builder pattern due to their complex chaining and type inference needs, webhooks are simpler:
- Single responsibility: transform incoming requests
- No complex type chaining between methods
- Clear, simple interface that's easy to test

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

### Type Safety Through Code Generation

Similar to resources, the CLI:
1. Watches the `webhooks/` directory
2. Generates a `webhooks.d.ts` file with exports
3. Provides compile-time errors if webhooks are removed but still referenced

## Implementation Flow

1. **Webhook Registration**: When a brain returns webhook objects, the framework registers `(webhook_name, identifier, brain_run_id)` tuples

2. **Request Routing**: Incoming requests to `/webhooks/{name}` are routed to the appropriate webhook handler

3. **Handler Processing**: The webhook handler extracts the identifier and builds the typed response

4. **Brain Resume/Start**:
   - If `identifier` is returned: Look up brain run ID and resume with response
   - If `brain` is returned: Start new brain run with response as initial state

5. **Cleanup**: When brains complete or error, webhook registrations are removed

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