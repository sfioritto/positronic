# Positronic Project Guide

This guide covers project-level patterns and best practices for Positronic applications.

## Project Structure

A typical Positronic project has the following structure:

```
├── src/
│   ├── brain.ts         # Project brain wrapper
│   ├── brains/          # Brain definitions
│   ├── webhooks/        # Webhook definitions
│   ├── runner.ts        # Local runner for development
│   ├── services/        # Service implementations
│   ├── utils/           # Shared utilities
│   └── components/      # Reusable UI/prompt components
├── resources/       # Files accessible to brains
├── tests/           # Test files
├── docs/            # Documentation
└── positronic.config.json  # Project configuration
```

## The Project Brain Pattern

Every Positronic project includes a `src/brain.ts` file. This file exports a custom `brain` function that wraps the core Positronic brain function.

### Why Use a Project Brain?

The project brain pattern provides a single place to:
- Configure plugins that all brains can access
- Set up logging, monitoring, or analytics
- Add authentication or API clients
- Establish project-wide conventions

### Basic Usage

All brains in your project should import from `../brain.js` instead of `@positronic/core`:

```typescript
// ✅ DO THIS (from a file in src/brains/)
import { brain } from '../brain.js';

// ❌ NOT THIS
import { brain } from '@positronic/core';
```

### Configuring Plugins

To add project-wide plugins, modify the `src/brain.ts` file using `createBrain()`. Plugins are defined with `definePlugin` and passed to `createBrain({ plugins: [...] })`:

```typescript
// src/plugins/logger.ts
import { definePlugin } from '@positronic/core';

export const logger = definePlugin({
  name: 'logger',
  create: () => ({
    info: (msg: string) => console.log(`[<%= '${new Date().toISOString()}' %>] INFO: <%= '${msg}' %>`),
    error: (msg: string) => console.error(`[<%= '${new Date().toISOString()}' %>] ERROR: <%= '${msg}' %>`),
  }),
});
```

```typescript
// src/plugins/database.ts
import { definePlugin } from '@positronic/core';

export const database = definePlugin({
  name: 'database',
  create: () => ({
    get: async (key: string) => {
      // Your database implementation
      return localStorage.getItem(key);
    },
    set: async (key: string, value: any) => {
      // Your database implementation
      localStorage.setItem(key, JSON.stringify(value));
    },
  }),
});
```

```typescript
// src/brain.ts
import { createBrain } from '@positronic/core';
import { logger } from './plugins/logger.js';
import { database } from './plugins/database.js';

export const brain = createBrain({
  plugins: [logger, database],
});
```

Now all brains automatically have access to these plugins:

```typescript
import { brain } from '../brain.js';

export default brain('User Processor')
  .step('Load User', async ({ logger, database }) => {
    logger.info('Loading user data');
    const userData = await database.get('current-user');
    return { user: userData };
  });
```

## Resource Organization

Resources are files that brains can access during execution. Organize them logically:

```
resources/
├── prompts/          # AI prompt templates
│   ├── customer-support.md
│   └── code-review.md
├── data/            # Static data files
│   └── config.json
└── templates/       # Document templates
    └── report.md
```

## Testing Strategy

Keep test files in the `tests/` directory to avoid deployment issues. Tests should:
- Focus on brain outcomes, not implementation
- Use mock clients and services
- Verify the final state and important side effects

See `/docs/brain-testing-guide.md` for detailed testing guidance.

## Development Workflow

1. **Start the development server**: `px server -d`
2. **Create or modify brains**: Always import from `../brain.js` (from files in `src/brains/`)
3. **Test locally**: 
   ```bash
   # Basic run
   px brain run <brain-name>
   
   # Run with options
   px brain run <brain-name> -o channel=#dev -o debug=true
   
   # Watch execution in real-time
   px brain run <brain-name> --watch
   ```
4. **Run tests**: `npm test`
5. **Deploy**: Backend-specific commands (e.g., `px deploy` for Cloudflare)

## Configuration

The `positronic.config.json` file contains project metadata:

```json
{
  "projectName": "my-project",
  "backend": "cloudflare"
}
```

## Environment Variables

Use `.env` files for configuration:

```bash
# API Keys
ANTHROPIC_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here

# Backend-specific (Cloudflare example)
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
```

## Best Practices

1. **Plugins**: Configure once in `src/brain.ts`, use everywhere
2. **Resources**: Use for content that non-developers should be able to edit
3. **Secrets**: Never commit API keys; use environment variables
4. **Organization**: Group related brains in folders as your project grows
5. **Testing**: Write tests for critical workflows
6. **Documentation**: Keep project-specific docs in the `docs/` folder

## Common Patterns

### Logging and Monitoring

```typescript
// src/plugins/metrics.ts
import { definePlugin } from '@positronic/core';

export const metrics = definePlugin({
  name: 'metrics',
  create: () => ({
    track: (event: string, properties?: any) => {
      // Your analytics implementation
      console.log('track', event, properties);
    },
    time: (label: string) => {
      const start = Date.now();
      return () => console.log(label, Date.now() - start, 'ms');
    },
  }),
});
```

```typescript
// In your brain
export default brain('Analytics Brain')
  .step('Start Timer', ({ metrics }) => {
    const endTimer = metrics.time('processing');
    return { endTimer };
  })
  .step('Process', ({ state }) => {
    // Do work...
    return state;
  })
  .step('End Timer', ({ state, metrics }) => {
    state.endTimer();
    metrics.track('processing_complete');
    return state;
  });
```

### API Integration

```typescript
// src/plugins/api.ts
import { definePlugin } from '@positronic/core';

export const api = definePlugin({
  name: 'api',
  setup: (config: { baseUrl: string; apiKey: string }) => config,
  create: ({ config }) => ({
    get: async (path: string) => {
      const response = await fetch(`<%= '${config!.baseUrl}${path}' %>`, {
        headers: { 'Authorization': `Bearer <%= '${config!.apiKey}' %>` }
      });
      return response.json();
    },
    post: async (path: string, data: any) => {
      const response = await fetch(`<%= '${config!.baseUrl}${path}' %>`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer <%= '${config!.apiKey}' %>`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return response.json();
    },
  }),
});
```

## currentUser

Every brain run requires a `currentUser` — an object with at least a `name` field that identifies who is running the brain. This identity is used to scope per-user data like memory and store fields.

### How currentUser Gets Set

The way `currentUser` is provided depends on how the brain is running:

**Deployed (Cloudflare / production)**: The backend sets `currentUser` from the authenticated request. When a user hits an API endpoint to start a brain run, the auth middleware determines their identity and passes it through. You don't need to set it manually.

**Local development with `px brain run`**: The CLI passes a default user identity automatically. You don't need to do anything special.

**Local development with `runner.ts`**: When calling `runner.run()` directly, you must pass `currentUser`:

```typescript
import { runner } from './src/runner.js';
import myBrain from './src/brains/my-brain.js';

await runner.run(myBrain, {
  currentUser: { name: 'local-dev-user' },
});
```

**In tests**: Pass `currentUser` when running the brain:

```typescript
const events = await collectEvents(
  testBrain.run({
    client: mockClient,
    currentUser: { name: 'test-user' },
  })
);
```

### What currentUser Scopes

- **Memory**: All memory operations (search, add) are automatically scoped to the current user. No need to pass `userId` manually — see [docs/memory-guide.md](memory-guide.md).
- **Store (per-user fields)**: Store fields marked with `perUser: true` are automatically scoped to the current user — see [docs/brain-dsl-guide.md](brain-dsl-guide.md).

### Accessing currentUser in Steps

`currentUser` is available in step context if you need it:

```typescript
export default brain('greet')
  .step('Hello', ({ currentUser }) => ({
    greeting: 'Hello, user ' + currentUser.name,
  }));
```

## Getting Help

- **Documentation**: https://positronic.dev
- **CLI Help**: `px --help`
- **Brain DSL Guide**: `/docs/brain-dsl-guide.md` (includes page steps for generating forms)
- **Memory Guide**: `/docs/memory-guide.md`
- **Testing Guide**: `/docs/brain-testing-guide.md`