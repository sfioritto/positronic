# Core Testing Guide

## Overview

The Core package tests focus on Brain DSL workflows, event sequences, and state management. This guide helps you write effective tests while avoiding common pitfalls.

## Key Testing Patterns

### 1. Brain Event Collection Pattern

**The Challenge**: Brains emit async events that need to be collected and verified.

**Solution**: Always collect ALL events before making assertions:

```typescript
// CORRECT: Collect all events first
const events = [];
for await (const event of brain.run({ client: mockClient })) {
  events.push(event);
}

// Now make assertions
expect(events.map((e) => e.type)).toContain(BRAIN_EVENTS.COMPLETE);

// WRONG: Don't try to assert while iterating
for await (const event of brain.run()) {
  expect(event).toBeDefined(); // This can miss events!
}
```

### 2. State Reconstruction via State Machine

**The Challenge**: Brain state is represented as JSON patches, not direct state objects. Manually applying patches breaks for nested brains and iterate steps because inner-brain patches are scoped differently — the state machine handles depth tracking automatically.

**Solution**: Replay events through the brain execution state machine:

```typescript
import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';

// Helper defined at the top of brain.test.ts
function finalStateFromEvents(events: BrainEvent<any>[]): any {
  const sm = createBrainExecutionMachine();
  for (const event of events) {
    sendEvent(sm, event as any);
  }
  return sm.context.currentState;
}

// Usage
const events = [];
for await (const event of brain.run({
  client: mockClient,
  currentUser: { name: 'test-user' },
})) {
  events.push(event);
}
const finalState = finalStateFromEvents(events);
expect(finalState).toEqual({ expected: 'state' });
```

**Why not manual `applyPatches`?** For flat brains it works, but nested brains and iterate steps emit inner-brain `STEP_COMPLETE` events whose patches should not be applied to the outer state. The state machine correctly scopes patches by nesting depth.

### 3. Mock Setup for AI Clients

**The Challenge**: Brains often depend on AI client calls that need specific mock setup.

**Solution**: Create properly typed mocks:

```typescript
// Setup mock client with proper typing
const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
const mockClient: jest.Mocked<ObjectGenerator> = {
  generateObject: mockGenerateObject,
};

// Configure response BEFORE running brain
mockGenerateObject.mockResolvedValue({ result: 'test data' });

// Now run the brain
const brain = brain('test').step('Gen', async ({ client }) => {
  const res = await client.generateObject({ prompt: 'test' });
  return { data: res.result };
});
```

### 4. Resource Loading Mocks

**The Challenge**: Resources use a proxy API that's tricky to mock.

**Solution**: Mock the underlying loader, not the proxy:

```typescript
const mockResourceLoad = jest.fn();
const mockResourceLoader: ResourceLoader = {
  load: mockResourceLoad,
};

// Setup resource responses
const mockResources = {
  'example.txt': { type: 'text', content: 'Hello' },
  'data.json': { type: 'text', content: '{"key": "value"}' },
};

mockResourceLoad.mockImplementation(async (path) => {
  const resource = mockResources[path];
  if (!resource) throw new Error(`Resource not found: ${path}`);
  return resource;
});

// Use in brain - the proxy API will call your mock
const brain = brain('test').step('Load', async ({ resources }) => {
  const text = await resources.example.loadText(); // Proxy API
  return { content: text };
});
```

### 5. Testing Error Events

**The Challenge**: Errors emit special events but brain execution continues.

**Solution**: Look for ERROR events, not exceptions:

```typescript
const errorBrain = brain('test').step('Fail', () => {
  throw new Error('Step failed');
});

const events = [];
for await (const event of errorBrain.run()) {
  events.push(event);
}

// Find the error event
const errorEvent = events.find((e) => e.type === BRAIN_EVENTS.ERROR);
expect(errorEvent).toBeDefined();
expect(errorEvent?.error.message).toBe('Step failed');

// Brain still completes!
expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
```

### 6. Type Inference Testing

**The Challenge**: Brain DSL uses complex TypeScript inference that needs testing.

**Solution**: Use compile-time type assertions:

```typescript
// Define a type equality helper
type AssertEquals<T, U> = T extends U ? (U extends T ? true : false) : false;

// Test that state types are inferred correctly
const typedBrain = brain('test')
  .step('Init', () => ({ count: 0 }))
  .step('Inc', ({ state }) => ({ count: state.count + 1 }));

// Extract the inferred state type
type InferredState = typeof typedBrain extends Brain<infer S> ? S : never;

// This line will fail compilation if types don't match
type Test = AssertEquals<InferredState, { count: number }>;
const _: Test = true;
```

## Common Pitfalls & Solutions

### Pitfall 1: Forgetting to Mock Client Methods

```typescript
// WRONG: Forgot to mock generateObject
const brain = brain('test').step('Gen', async ({ client }) => {
  const res = await client.generateObject({ prompt: 'test' });
  return res;
});

// This will fail with "mockGenerateObject is not a function"
await brain.run({ client: mockClient });

// CORRECT: Always mock methods before use
mockGenerateObject.mockResolvedValue({ data: 'test' });
```

### Pitfall 2: Testing During Event Iteration

```typescript
// WRONG: Testing while iterating can miss events
let foundComplete = false;
for await (const event of brain.run()) {
  if (event.type === BRAIN_EVENTS.COMPLETE) {
    foundComplete = true;
    break; // Stops iteration early!
  }
}

// CORRECT: Collect all events first
const events = await collectAllEvents(brain.run());
const foundComplete = events.some((e) => e.type === BRAIN_EVENTS.COMPLETE);
```

### Pitfall 3: Not Handling Async Steps

```typescript
// WRONG: Synchronous step function when async is needed
const brain = brain('test').step('Async', ({ client }) => {
  // This won't wait for the promise!
  client.generateObject({ prompt: 'test' });
  return { done: true };
});

// CORRECT: Use async/await
const brain = brain('test').step('Async', async ({ client }) => {
  const result = await client.generateObject({ prompt: 'test' });
  return { done: true, result };
});
```

### Pitfall 4: Incorrect Event Sequence Expectations

```typescript
// WRONG: Expecting only main events
expect(events.map((e) => e.type)).toEqual([
  BRAIN_EVENTS.START,
  BRAIN_EVENTS.COMPLETE,
]);

// CORRECT: Include all events in sequence
expect(events.map((e) => e.type)).toEqual([
  BRAIN_EVENTS.START,
  BRAIN_EVENTS.STEP_STATUS, // Don't forget status events!
  BRAIN_EVENTS.STEP_START,
  BRAIN_EVENTS.STEP_COMPLETE,
  BRAIN_EVENTS.STEP_STATUS,
  BRAIN_EVENTS.COMPLETE,
]);
```

## Quick Test Template

```typescript
import { brain, BRAIN_EVENTS } from '@positronic/core';
import {
  createBrainExecutionMachine,
  sendEvent,
} from '../src/dsl/brain-state-machine.js';
import type { BrainEvent } from '../src/dsl/brain.js';
import type { ObjectGenerator, ResourceLoader } from '@positronic/core';

// Helper: replay events through state machine to get final state
function finalStateFromEvents(events: BrainEvent<any>[]): any {
  const sm = createBrainExecutionMachine();
  for (const event of events) {
    sendEvent(sm, event as any);
  }
  return sm.context.currentState;
}

describe('my brain feature', () => {
  // Setup mocks
  const mockGenerateObject = jest.fn<ObjectGenerator['generateObject']>();
  const mockClient: jest.Mocked<ObjectGenerator> = {
    generateObject: mockGenerateObject,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should do something', async () => {
    // Configure mocks
    mockGenerateObject.mockResolvedValue({ result: 'test' });

    // Define brain
    const testBrain = brain('test').step('Process', async ({ client }) => {
      const res = await client.generateObject({ prompt: 'test' });
      return { processed: res.result };
    });

    // Collect all events
    const events = [];
    for await (const event of testBrain.run({
      client: mockClient,
      currentUser: { name: 'test-user' },
    })) {
      events.push(event);
    }

    // Verify final state
    const finalState = finalStateFromEvents(events);
    expect(finalState).toEqual({ processed: 'test' });

    // Verify completion
    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
  });
});
```

## Running Tests

```bash
# From monorepo root (required!)
npm test -- packages/core           # Run all core tests
npm test -- brain.test.ts          # Run specific test file
npm test -- -t "should process"    # Run tests matching pattern
npm run test:watch                 # Watch mode
npm run build:workspaces          # Ensure TypeScript compiles
```
