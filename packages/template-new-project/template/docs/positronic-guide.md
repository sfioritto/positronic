# Positronic Project Guide

This guide covers project-level patterns and best practices for Positronic applications.

## Project Structure

A typical Positronic project has the following structure:

```
├── brain.ts         # Project brain wrapper
├── brains/          # Brain definitions
├── resources/       # Files accessible to brains
├── tests/           # Test files
├── docs/            # Documentation
├── runner.ts        # Local runner for development
└── positronic.config.json  # Project configuration
```

## The Project Brain Pattern

Every Positronic project includes a `brain.ts` file in the root directory. This file exports a custom `brain` function that wraps the core Positronic brain function.

### Why Use a Project Brain?

The project brain pattern provides a single place to:
- Configure services that all brains can access
- Set up logging, monitoring, or analytics
- Add authentication or API clients
- Establish project-wide conventions

### Basic Usage

All brains in your project should import from `../brain.js` instead of `@positronic/core`:

```typescript
// ✅ DO THIS (from a file in the brains/ directory)
import { brain } from '../brain.js';

// ❌ NOT THIS
import { brain } from '@positronic/core';
```

### Configuring Services

To add project-wide services, modify the `brain.ts` file in the root directory using `createBrain()`:

```typescript
import { createBrain } from '@positronic/core';

// Define your services
interface ProjectServices {
  logger: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  database: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
  };
}

// Export the project brain factory
export const brain = createBrain({
  services: {
    logger: {
      info: (msg) => console.log(`[<%= '${new Date().toISOString()}' %>] INFO: <%= '${msg}' %>`),
      error: (msg) => console.error(`[<%= '${new Date().toISOString()}' %>] ERROR: <%= '${msg}' %>`)
    },
    database: {
      get: async (key) => {
        // Your database implementation
        return localStorage.getItem(key);
      },
      set: async (key, value) => {
        // Your database implementation
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
  }
});
```

Now all brains automatically have access to these services:

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
2. **Create or modify brains**: Always import from `./brain.js`
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

1. **Services**: Configure once in `brain.ts`, use everywhere
2. **Resources**: Use for content that non-developers should be able to edit
3. **Secrets**: Never commit API keys; use environment variables
4. **Organization**: Group related brains in folders as your project grows
5. **Testing**: Write tests for critical workflows
6. **Documentation**: Keep project-specific docs in the `docs/` folder

## Common Patterns

### Logging and Monitoring

```typescript
// In brain.ts
interface ProjectServices {
  metrics: {
    track: (event: string, properties?: any) => void;
    time: (label: string) => () => void;
  };
}

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
// In brain.ts
interface ProjectServices {
  api: {
    get: (path: string) => Promise<any>;
    post: (path: string, data: any) => Promise<any>;
  };
}

// Configure with base URL and auth
const api = {
  get: async (path: string) => {
    const response = await fetch(`https://api.example.com<%= '${path}' %>`, {
      headers: { 'Authorization': `Bearer <%= '${process.env.API_KEY}' %>` }
    });
    return response.json();
  },
  post: async (path: string, data: any) => {
    const response = await fetch(`https://api.example.com<%= '${path}' %>`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer <%= '${process.env.API_KEY}' %>`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    return response.json();
  }
};
```

## Getting Help

- **Documentation**: https://positronic.dev
- **CLI Help**: `px --help`
- **Brain DSL Guide**: `/docs/brain-dsl-guide.md` (includes UI steps for generating forms)
- **Testing Guide**: `/docs/brain-testing-guide.md`