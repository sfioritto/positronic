# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Positronic project - an AI-powered framework for building and running "brains" (stateful AI workflows) that can be deployed to various cloud backends. It provides a fluent DSL for defining AI workflows, resource management, and a CLI for development and deployment.

## Project Structure

- **`/brains`** - AI workflow definitions using the Brain DSL
- **`/resources`** - Files and documents that brains can access via the resource system
- **`/runner.ts`** - The main entry point for running brains locally
- **`/positronic.config.json`** - Project configuration

## Key Commands

### Development

- `px brain run <brain-name>` - Run a brain workflow
- `px brain list` - List all available brains
- `px resource list` - List all available resources
- `px server` - Start the local development server

### Testing & Building

- `npm test` - Run tests
- `npm run build` - Build the project
- `npm run dev` - Start development mode with hot reload

## Brain DSL

The Brain DSL provides a fluent API for defining AI workflows:

```typescript
import { brain } from '@positronic/core';

const myBrain = brain('my-brain')
  .step('Initialize', ({ state }) => ({
    ...state,
    initialized: true
  }))
  .step('Process', async ({ state, resources }) => {
    // Access resources
    const doc = await resources.get('example.md');
    return {
      ...state,
      processed: true,
      content: doc.content
    };
  });

export default myBrain;
```

## Resource System

Resources are files that brains can access during execution. They're stored in the `/resources` directory and are automatically typed based on the manifest.

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
4. **Testing**: Test brains with various input states

## Getting Help

- Documentation: https://positronic.dev
- GitHub: https://github.com/positronic-ai/positronic
- CLI Help: `px --help` or `px <command> --help`