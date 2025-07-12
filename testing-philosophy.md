# Testing Philosophy for Positronic

This document outlines the testing philosophy for the Positronic monorepo, based on Kent C. Dodds' testing principles. Before writing or updating tests, please read these foundational articles:

- [How to Know What to Test](https://kentcdodds.com/blog/how-to-know-what-to-test)
- [Write Tests. Not Too Many. Mostly Integration.](https://kentcdodds.com/blog/write-tests)

## Core Principles

### 1. Test Use Cases, Not Implementation

**Focus on how users interact with the software rather than internal implementation details.**

- Test the public API and observable behavior
- Avoid testing lifecycle methods, internal state, or private functions
- Tests should rarely need changing when refactoring code

### 2. The Testing Trophy

Rather than the traditional testing pyramid, we follow the "Testing Trophy" approach:

```
       🏆
    E2E Tests
  Integration Tests
Unit Tests & Static
```

- **Static Analysis**: TypeScript, ESLint (foundation)
- **Unit Tests**: For complex business logic and utilities
- **Integration Tests**: The bulk of our tests (best ROI)
- **E2E Tests**: Critical user paths only

### 3. "Write tests. Not too many. Mostly integration."

This quote from Guillermo Rauch (via Kent C. Dodds) captures our approach:
- Write tests to build confidence
- Don't aim for 100% coverage (diminishing returns after ~70%)
- Prioritize integration tests that verify component interactions

## Examples from Our Codebase

### CLI Integration Tests (`packages/cli/src/commands/*.test.ts`)

Our CLI tests exemplify the integration-first approach:

```typescript
// From schedule.test.ts - Testing the full command execution
it('should create a new schedule', async () => {
  const env = await createTestEnv();
  const px = await env.start();
  
  try {
    const { waitForOutput, instance } = await px([
      'schedule',
      'create',
      'test-brain',
      '0 3 * * *',
    ]);

    // Test user-visible output
    const foundSuccess = await waitForOutput(/Schedule created successfully/i, 50);
    expect(foundSuccess).toBe(true);

    // Verify integration with API
    const methodCalls = env.server.getLogs();
    const createCall = methodCalls.find((call) => call.method === 'createSchedule');
    expect(createCall).toBeDefined();
  } finally {
    await env.stopAndCleanup();
  }
});
```

**Why this follows our philosophy:**
- Tests the complete user interaction (running a CLI command)
- Verifies observable behavior (success message)
- Checks integration points (API calls)
- Uses minimal mocking (only the backend server)

### Core Unit Tests (`packages/core/src/dsl/*.test.ts`)

For complex business logic, we use focused unit tests:

```typescript
// Testing Brain DSL - complex state management logic
const testBrain = brain('test-brain')
  .step('Initialize', ({ state }) => ({ count: 0 }))
  .step('Increment', ({ state }) => ({ count: state.count + 1 }));
```

**When to use unit tests:**
- Complex algorithms (JSON patch operations)
- State management logic
- Utility functions with edge cases

### What We Don't Test

Following the principle of not testing implementation details:

1. **We don't test React component internals** - Instead, we test the rendered output
2. **We don't mock everything** - Our tests use real implementations where practical
3. **We don't test private methods** - We test through the public API

## Practical Guidelines for This Monorepo

### 1. Package-Specific Approaches

- **CLI (`packages/cli`)**: Integration tests that execute commands
- **Core (`packages/core`)**: Mix of unit tests for algorithms and integration tests for workflows
- **Backends (`packages/cloudflare`, etc.)**: Integration tests with mock clients
- **Clients (`packages/client-*`)**: Integration tests with recorded/mocked HTTP

### 2. Test Utilities

We've built test utilities that support integration testing:

```typescript
// createTestEnv() provides a complete test environment
const env = await createTestEnv();
const px = await env.start(); // Starts mock server

// TestDevServer provides realistic API mocking
server.addSchedule({ ... }); // Pre-populate test data
```

### 3. When to Write Each Type of Test

**Write Integration Tests When:**
- Testing CLI commands
- Testing API endpoints
- Testing brain execution flows
- Testing resource loading
- Testing client-server interactions

**Write Unit Tests When:**
- Testing pure functions with complex logic
- Testing edge cases in algorithms
- Testing error handling in utilities
- Testing data transformations

**Write E2E Tests When:**
- Testing critical user journeys
- Testing deployment scenarios
- Testing cross-package integrations

### 4. Coverage Guidelines

- Don't mandate 100% coverage
- Focus on testing code that would upset you if it broke
- Prioritize based on:
  - User impact
  - Complexity
  - Likelihood of bugs

### 5. Test Maintenance

Good tests:
- Use descriptive names that explain the use case
- Are resilient to refactoring
- Test one concept per test
- Provide clear failure messages

## Running Tests

```bash
# From monorepo root (required!)
npm test                        # Run all tests
npm test -- watch.test.ts       # Run specific test file
npm test -- -t "test name"      # Run tests matching pattern
npm run test:watch             # Watch mode
npm run test:noisy -- file.ts  # See console output
npm run build:workspaces       # Ensure TypeScript compiles
```

## Summary

Our testing philosophy emphasizes:
1. **User-focused testing** over implementation details
2. **Integration tests** as the primary testing strategy
3. **Pragmatic coverage** over 100% metrics
4. **Minimal mocking** to maintain test confidence

Remember: The more your tests resemble the way your software is used, the more confidence they can give you.