# CLI Testing Guide

## Overview

The CLI uses a sophisticated testing setup that allows testing React/Ink components with mocked API servers. Understanding the test architecture is crucial for writing effective tests.

## Key Testing Concepts

### 1. Command Pattern for Testability

CLI commands follow a specific pattern to enable testing:

```typescript
// Commands return React components instead of calling render()
create(args): React.ReactElement {
  return React.createElement(ScheduleCreate, { ...args });
}

// The CLI calls render() with the returned component
// This allows tests to inject their own render function
```

### 2. Test Environment Setup

Every test needs proper environment setup:

```typescript
const env = await createTestEnv(); // Creates temp project dir & test server
const px = await env.start(); // CRITICAL: Start the mock server!

try {
  const { waitForOutput, instance } = await px(['command', 'args']);
  // Test assertions here
} finally {
  await env.stopAndCleanup();
}
```

**Common mistake**: Forgetting `await env.start()` results in no API calls being made.

### 3. Mock Server (TestDevServer)

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

### 4. Testing Patterns

**Success Path Testing**:

```typescript
const { waitForOutput, instance } = await px([
  'schedule',
  'create',
  'brain',
  '0 * * * *',
]);
const foundSuccess = await waitForOutput(/Schedule created successfully/i);
expect(foundSuccess).toBe(true);

// Verify API calls
const calls = env.server.getLogs();
const createCall = calls.find((c) => c.method === 'createSchedule');
expect(createCall).toBeDefined();
```

**Error Testing**:

```typescript
// Connection errors: Don't start server
const { waitForOutput } = await px(['command'], { server: env.server });
const foundError = await waitForOutput(/Error connecting/i);

// Server errors: Mock error responses
server.stop(); // or mock to return errors
```

### 5. Common Pitfalls & Solutions

**Process.exit in middleware**: Some commands use process.exit which breaks tests

- Solution: Mock process.exit in tests that trigger it

**Async rendering**: React components render asynchronously

- Solution: Use `waitForOutput()` with sufficient retries
- Debug with `console.log(instance.lastFrame())`

**Error message matching**: Error messages come from `useApi` hooks, not components

- Check actual error text: "Error connecting to the local development server"
- Not: "Could not connect to positronic server"

### 6. Testing Tools

- `waitForOutput(regex, maxTries)` - Wait for text to appear (default 10 tries)
- `instance.lastFrame()` - Get current rendered output
- `server.getLogs()` - Verify API calls
- `server.addSchedule()` etc. - Pre-populate test data

### 7. Test Coverage Strategy

1. Start with one subcommand at a time
2. Test both success and error paths
3. Verify API interactions, not just UI output
4. Follow existing test patterns for consistency

## Quick Test Template

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
      expect(calls.some((c) => c.method === 'expectedMethod')).toBe(true);
    } finally {
      await env.stopAndCleanup();
    }
  });
});
```
