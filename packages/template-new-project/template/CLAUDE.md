# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Positronic project - an AI-powered framework for building and running "brains" (stateful AI workflows) that can be deployed to various cloud backends. It provides a fluent DSL for defining AI workflows, resource management, and a CLI for development and deployment.

## Project Structure

- **`/brains`** - AI workflow definitions using the Brain DSL
- **`/webhooks`** - Webhook definitions for external integrations (auto-discovered)
- **`/resources`** - Files and documents that brains can access via the resource system
- **`/tests`** - Test files for brains (kept separate to avoid deployment issues)
- **`/docs`** - Documentation including brain testing guide
- **`/runner.ts`** - The main entry point for running brains locally
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

## Resource System

Resources are files that brains can access during execution. They're stored in the `/resources` directory and are automatically typed based on the manifest.

## Webhooks

Webhooks allow brains to pause execution and wait for external events (like form submissions, API callbacks, or user approvals). Webhooks are auto-discovered from the `/webhooks` directory.

### Creating a Webhook

Create a file in the `/webhooks` directory with a default export:

```typescript
// webhooks/approval.ts
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

export default brain('approval-workflow')
  .step('Request approval', ({ state }) => ({
    ...state, status: 'pending',
  }))
  .wait('Wait for approval', ({ state }) => approvalWebhook(state.requestId))
  .step('Process approval', ({ state, response }) => ({
    ...state,
    status: response.approved ? 'approved' : 'rejected',
    reviewerNote: response.reviewerNote,
  }));
```

### How Auto-Discovery Works

- Place webhook files in `/webhooks` directory
- Each file must have a default export using `createWebhook()`
- The dev server generates `_webhookManifest.ts` automatically
- Webhook name comes from the filename (e.g., `approval.ts` → `'approval'`)

## Development Workflow

1. Define your brain in `/brains`
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