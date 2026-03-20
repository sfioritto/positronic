# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Positronic project - an AI-powered framework for building and running "brains" (stateful AI workflows) that can be deployed to various cloud backends. It provides a fluent DSL for defining AI workflows, resource management, and a CLI for development and deployment.

## Project Structure

- **`/src`** - Application source code
  - **`/src/brain.ts`** - Project brain wrapper (custom `brain` function)
  - **`/src/brains`** - AI workflow definitions using the Brain DSL
  - **`/src/webhooks`** - Webhook definitions for external integrations (auto-discovered)
  - **`/src/runner.ts`** - The main entry point for running brains locally
  - **`/src/utils`** - Shared utilities (e.g., `bottleneck` for rate limiting)
  - **`/src/services`** - Service implementations for external integrations
  - **`/src/components`** - Reusable UI/prompt components
- **`/resources`** - Files and documents that brains can access via the resource system
- **`/tests`** - Test files for brains (kept separate to avoid deployment issues)
- **`/docs`** - Documentation including brain testing guide
- **`/positronic.config.json`** - Project configuration

## Key Commands

### Development

- `px brain run <brain-name>` - Run a brain workflow
- `px brain list` - List all available brains
- `px resource list` - List all available resources
- `px server` - Start the local development server (add `-d` for background mode)

### Testing & Building

- `npm test` - Run tests (uses Jest with local test utilities)
- `npm run build` - Build the project
- `npm run dev` - Start development mode with hot reload

For testing guidance, see `/docs/brain-testing-guide.md`

## Brain DSL

The Brain DSL provides a fluent API for defining AI workflows:

```typescript
// Import from the project brain wrapper (see positronic-guide.md)
// From a file in src/brains/, brain.ts is at src/brain.ts
import { brain } from '../brain.js';

const myBrain = brain('my-brain')
  .step('Initialize', ({ state }) => ({
    ...state,
    initialized: true
  }))
  .step('Process', async ({ state, resources }) => {
    // Access resources with type-safe API
    const content = await resources.example.loadText();
    return {
      ...state,
      processed: true,
      content
    };
  });

export default myBrain;
```

### JSX Templates

Templates in `.prompt()`, `.ui()`, and `.map()` steps can be written as JSX for better readability. Rename the brain file to `.tsx` and return JSX from the template function. See `/docs/brain-dsl-guide.md` for details.

## Resource System

Resources are files that brains can access during execution. They're stored in the `/resources` directory and are automatically typed based on the manifest.

## Webhooks

Webhooks allow brains to pause execution and wait for external events, or to start new brain runs from incoming requests (like GitHub events or Slack messages). Webhooks are auto-discovered from the `/src/webhooks` directory.

### Creating a Webhook

Create a file in the `/src/webhooks` directory with a default export:

```typescript
// src/webhooks/approval.ts
import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const approvalWebhook = createWebhook(
  'approval',  // webhook name (should match filename)
  z.object({   // response schema - what the webhook returns to the brain
    approved: z.boolean(),
    reviewerNote: z.string().optional(),
  }),
  async (request: Request) => {
    // Parse the incoming request and return identifier + response
    const body = await request.json();
    return {
      type: 'webhook',
      identifier: body.requestId,  // matches the identifier used in waitFor
      response: {
        approved: body.approved,
        reviewerNote: body.note,
      },
    };
  }
);

export default approvalWebhook;
```

### Using Webhooks in Brains

Import the webhook and use `.wait()` to pause execution:

```typescript
import { brain } from '../brain.js';
import approvalWebhook from '../webhooks/approval.js';
// Note: these imports work from src/brains/ since both brain.ts and webhooks/ are in src/

export default brain('approval-workflow')
  .step('Request approval', ({ state }) => ({
    ...state, status: 'pending',
  }))
  .wait('Wait for approval', ({ state }) => approvalWebhook(state.requestId), { timeout: '24h' })
  .handle('Process approval', ({ state, response }) => ({
    ...state,
    status: response.approved ? 'approved' : 'rejected',
    reviewerNote: response.reviewerNote,
  }));
```

The optional `timeout` parameter accepts durations like `'30m'`, `'1h'`, `'24h'`, `'7d'`, or a number in milliseconds. If the timeout elapses without a webhook response, the brain is cancelled. Without a timeout, the brain waits indefinitely.

### CSRF Tokens for Pages with Forms

If your brain generates a custom HTML page with a form that submits to a webhook, you must include a CSRF token. Without a token, the server will reject the submission.

1. Generate a token with `generateFormToken()` from `@positronic/core`
2. Include the token as a **query parameter** on the form's action URL: `action="<%= '${webhookUrl}' %>?token=<%= '${formToken}' %>"`
3. Pass the token when creating the webhook registration: `myWebhook(identifier, token)`

Do NOT use a hidden form field for the token — it must be in the URL query string.

The `.ui()` step handles this automatically. See `/docs/brain-dsl-guide.md` for full examples.

### Starting Brain Runs from Webhooks

Webhooks can also trigger new brain runs by adding a `triggers` config and returning `{ type: 'trigger' }` from the handler:

```typescript
// src/webhooks/github-pr.ts
import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const githubPR = createWebhook(
  'github-pr',
  z.object({ prNumber: z.number(), title: z.string() }),
  async (request: Request) => {
    const body = await request.json();
    if (body.action !== 'opened') return { type: 'ignore' };
    return {
      type: 'trigger',
      response: { prNumber: body.pull_request.number, title: body.pull_request.title },
    };
  },
  { brain: 'code-review', runAs: 'github-webhook' }
);

export default githubPR;
```

The handler return type determines the behavior:
- `{ type: 'trigger', response }` — starts a new brain run with `response` as `initialState`
- `{ type: 'webhook', identifier, response }` — resumes a waiting brain
- `{ type: 'ignore' }` — acknowledges receipt, takes no action
- `{ type: 'verification', challenge }` — handles webhook verification challenges

The `triggers` config requires `brain` (brain title to start) and `runAs` (user identity for the run). Only webhooks with explicit `triggers` config can start brains — the handler validates the incoming request first.

### How Auto-Discovery Works

- Place webhook files in `/src/webhooks` directory
- Each file must have a default export using `createWebhook()`
- The dev server generates `_webhookManifest.ts` automatically
- Webhook name comes from the filename (e.g., `approval.ts` → `'approval'`)

## Development Workflow

1. Define your brain in `/src/brains`
2. Add any required resources to `/resources`
3. Run `px brain run <brain-name>` to test locally
4. Deploy using backend-specific commands

## Backend-Specific Notes

<% if (backend === 'cloudflare') { %>
### Cloudflare Workers

This project is configured for Cloudflare Workers deployment:

- Uses Durable Objects for state persistence
- R2 for resource storage
- Requires Cloudflare account and API keys

Deployment:
```bash
# Configure Cloudflare credentials
wrangler login

# Deploy
px deploy
```
<% } else if (backend === 'none') { %>
### Core Only

This project uses only the Positronic core without a specific deployment backend. You can:

- Run brains locally using `px brain run`
- Add a backend later by installing the appropriate package
- Use the framework for local AI workflow development
<% } %>

## Best Practices

1. **State Management**: Keep brain state minimal and serializable
2. **Resource Naming**: Use descriptive names for resources (e.g., `prompt-templates/customer-support.md`)
3. **Error Handling**: Always handle potential errors in brain steps
4. **Testing**: Write tests for your brains focusing on outcomes, not implementation details (see `/docs/brain-testing-guide.md`)

## Getting Help

- Documentation: https://positronic.dev
- GitHub: https://github.com/positronic-ai/positronic
- CLI Help: `px --help` or `px <command> --help`

## Project-Level Patterns

For project structure, the project brain pattern, and other Positronic conventions, see:
@docs/positronic-guide.md

## Additional Tips for AI Agents

@docs/tips-for-agents.md