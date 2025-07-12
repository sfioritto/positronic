# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Positronic is an AI-powered framework for building and running "brains" - stateful AI workflows that can be deployed to various cloud backends. It provides a fluent DSL for defining AI workflows, resource management, and a CLI for development and deployment.

## Key Commands

### Development
- `npm run dev` - Build all workspaces and run tests with notifications
- `npm run dev:watch` - Watch mode for development (builds and tests)
- `npm test` - Run all tests silently
- `npm run test:watch` - Run tests in watch mode
- `npm run test:all` - Run all tests including integration tests (requires API keys)
- `npm run format` - Format code with Prettier
- **Important**: Run `npm run build:workspaces` frequently to ensure TypeScript compilation succeeds, in addition to running tests

### Build and Clean
- `npm run build:workspaces` - Build all workspace packages
- `npm run clean:workspaces` - Clean all workspace build artifacts

### Running a Single Test
**Important**: Tests must be run from the monorepo root directory, not from individual packages.
- `npm test -- packages/path/to/test.spec.ts` - Run a specific test file
- `npm test -- watch.test.ts` - Run tests by filename (searches all packages)
- `npm test -- -t "test name"` - Run tests matching a pattern
- `npm run test:noisy -- watch.test.ts` - Run tests with console output (shows console.error, console.log, etc.)

## Architecture Overview

### Monorepo Structure
The project uses npm workspaces with the following packages:

- **`/packages/core`** - Core framework with Brain DSL, runner, resources, and JSON patch utilities
- **`/packages/cli`** - CLI tool (`px` or `positronic` commands) with commands for project, brain, resources, schedule, and server
- **`/packages/spec`** - Interface specifications, notably `PositronicDevServer` for backend implementations
- **`/packages/cloudflare`** - Cloudflare Workers backend with Durable Objects and R2 storage
- **`/packages/client-anthropic`** - Anthropic AI client integration
- **`/packages/client-vercel`** - Vercel client integration
- **`/packages/shell`** - Shell execution utilities
- **`/packages/template-new-project`** - Project scaffolding template

### Key Patterns

1. **Brain DSL**: Fluent API for defining AI workflows
   ```typescript
   brain('example')
     .step('Start', ({ state }) => ({ ...state, message: 'Hello' }))
     .step('Finish', ({ state }) => ({ ...state, done: true }))
   ```

2. **Backend Abstraction**: Backends implement `PositronicDevServer` interface, allowing multiple cloud provider implementations

3. **Resource System**: Manifest-based system for managing files and documents needed by AI brains

4. **State Management**: Uses JSON patches for efficient state updates and persistence

5. **Event-Driven**: Brains emit events (start, complete, error, step status) for monitoring

## Development Notes

### Type System
- TypeScript with strict mode enabled
- All packages use ESM modules
- Type definitions are auto-generated for resources in each project

### Coding Preferences
- Place all imports at the top of the file - avoid inline dynamic imports (`await import(...)`) except in rare cases
- Follow existing patterns in the codebase

### Testing
- Jest is the test framework
- Mock implementations available for API clients and dev servers
- Integration tests require environment variables (ANTHROPIC_API_KEY, etc.)

### CLI Development
- Uses React/Ink for interactive terminal UIs
- Components are in `/packages/cli/src/ink/`
- API client hooks follow React patterns

### Backend Development
- Implement the `PositronicDevServer` interface from `@positronic/spec`
- Handle resource syncing, brain execution, and scheduling
- See Cloudflare implementation as reference

## Current Architecture Tasks

From TODO.md, the team is working on:
1. Refactoring CLI server.ts to reduce orchestration logic by enriching the PositronicDevServer interface
2. Moving backend-specific logic from CLI into respective backend packages

## Environment Variables

For integration testing:
- `ANTHROPIC_API_KEY` - Required for Anthropic client tests
- `VERCEL_TOKEN` - Required for Vercel client tests

## Development Workflow
- Run `npm build:workspaces` and then `npm run test` from the top of this mono repo every time you change a file and addresses errors and test failures as needed

## CLI Testing Guide

### Overview
The CLI uses a sophisticated testing setup that allows testing React/Ink components with mocked API servers. Understanding the test architecture is crucial for writing effective tests.

### Key Testing Concepts

#### 1. Command Pattern for Testability
CLI commands follow a specific pattern to enable testing:
```typescript
// Commands return React components instead of calling render()
create(args): React.ReactElement {
  return React.createElement(ScheduleCreate, { ...args });
}

// The CLI calls render() with the returned component
// This allows tests to inject their own render function
```

#### 2. Test Environment Setup
Every test needs proper environment setup:
```typescript
const env = await createTestEnv();  // Creates temp project dir & test server
const px = await env.start();       // CRITICAL: Start the mock server!

try {
  const { waitForOutput, instance } = await px(['command', 'args']);
  // Test assertions here
} finally {
  await env.stopAndCleanup();
}
```

**Common mistake**: Forgetting `await env.start()` results in no API calls being made.

#### 3. Mock Server (TestDevServer)
- Uses `nock` to intercept HTTP requests
- Must mock all endpoints your component will call
- Tracks method calls via `getLogs()` for verification

Example endpoint mocking:
```typescript
// In test-dev-server.ts
nockInstance.post('/brains/schedules').reply(201, (uri, requestBody) => {
  const body = JSON.parse(requestBody);
  const schedule = { id: 'schedule-123', ...body };
  this.schedules.set(schedule.id, schedule);
  this.logCall('createSchedule', [body]);
  return schedule;
});
```

#### 4. Testing Patterns

**Success Path Testing**:
```typescript
const { waitForOutput, instance } = await px(['schedule', 'create', 'brain', '0 * * * *']);
const foundSuccess = await waitForOutput(/Schedule created successfully/i);
expect(foundSuccess).toBe(true);

// Verify API calls
const calls = env.server.getLogs();
const createCall = calls.find(c => c.method === 'createSchedule');
expect(createCall).toBeDefined();
```

**Error Testing**:
```typescript
// Connection errors: Don't start server
const { waitForOutput } = await px(['command'], { server: env.server });
const foundError = await waitForOutput(/Error connecting/i);

// Server errors: Mock error responses
server.stop();  // or mock to return errors
```

#### 5. Common Pitfalls & Solutions

**Process.exit in middleware**: Some commands use process.exit which breaks tests
- Solution: Mock process.exit in tests that trigger it

**Async rendering**: React components render asynchronously
- Solution: Use `waitForOutput()` with sufficient retries
- Debug with `console.log(instance.lastFrame())`

**Error message matching**: Error messages come from `useApi` hooks, not components
- Check actual error text: "Error connecting to the local development server"
- Not: "Could not connect to positronic server"

#### 6. Testing Tools

- `waitForOutput(regex, maxTries)` - Wait for text to appear (default 10 tries)
- `instance.lastFrame()` - Get current rendered output
- `server.getLogs()` - Verify API calls
- `server.addSchedule()` etc. - Pre-populate test data

#### 7. Test Coverage Strategy

1. Start with one subcommand at a time
2. Test both success and error paths
3. Verify API interactions, not just UI output
4. Follow existing test patterns for consistency

### Quick Test Template

```typescript
import { createTestEnv, px } from './test-utils.js';

describe('command name', () => {
  it('should do something', async () => {
    const env = await createTestEnv();
    const px = await env.start();
    
    try {
      const { waitForOutput } = await px(['command', 'subcommand', 'args']);
      
      const found = await waitForOutput(/expected output/i);
      expect(found).toBe(true);
      
      // Verify API calls if needed
      const calls = env.server.getLogs();
      expect(calls.some(c => c.method === 'expectedMethod')).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });
});
```