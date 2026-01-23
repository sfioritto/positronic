# Brain Testing Guide

This guide explains how to test Positronic brains using the testing utilities in the `tests/test-utils.ts` file.

## Test Organization

All test files should be placed in the `tests/` directory at the root of your project. This keeps tests separate from your brain implementations and prevents them from being deployed with your application.

Test files should follow the naming convention `<brain-name>.test.ts`. For example:
- Brain file: `brains/customer-support.ts`
- Test file: `tests/customer-support.test.ts`

## Testing Philosophy

Following the principles from [Kent C. Dodds' testing philosophy](https://kentcdodds.com/blog/write-tests):
- **Write tests. Not too many. Mostly integration.**
- Test user outcomes, not implementation details
- Focus on what your brain produces, not how it produces it

## Overview

Testing brains is about verifying they produce the correct outputs given specific AI responses. The testing utilities make it easy to mock AI responses and assert on the final results.

## Quick Start

```typescript
import { createMockClient, runBrainTest } from '../tests/test-utils.js';
import yourBrain from '../brains/your-brain.js';

describe('your-brain', () => {
  it('should process user data and generate a report', async () => {
    // Arrange: Set up AI responses
    const mockClient = createMockClient();
    mockClient.mockResponses(
      { analysis: 'User shows high engagement', score: 0.85 },
      { report: 'Detailed engagement report...', recommendations: ['A', 'B'] }
    );

    // Act: Run the brain
    const result = await runBrainTest(yourBrain, { client: mockClient });

    // Assert: Verify the outcome
    expect(result.completed).toBe(true);
    expect(result.finalState.report).toContain('Detailed engagement report');
    expect(result.finalState.recommendations).toHaveLength(2);
  });
});
```

## API Reference

### runBrainTest

```typescript
const result = await runBrainTest(brain, {
  client: mockClient,           // Optional: defaults to createMockClient()
  initialState: { count: 0 },   // Optional: initial state
  resources: resourceLoader,    // Optional: resources
  options: { mode: 'test' } // Optional: brain-specific options
});
```

**Returns:**
- `completed: boolean` - Whether the brain completed successfully
- `error: Error | null` - Any error that occurred
- `finalState: State` - The final state after all steps
- `events: BrainEvent[]` - All emitted events during execution

## MockClient API

### Creating a Mock Client

```typescript
const mockClient = createMockClient();
```

### Mocking Responses

Queue responses that will be consumed in order by `generateObject` calls:

```typescript
// Queue one or more responses
mockClient.mockResponses(
  { step1: 'completed' },
  { step2: 'processed' },
  { finalResult: 'success' }
);

// Clear all mocked responses
mockClient.clearMocks();
```

### Assertions

Use standard Jest assertions on the mock:

```typescript
// Check call count
expect(mockClient.generateObject).toHaveBeenCalledTimes(3);

// Check call parameters
expect(mockClient.generateObject).toHaveBeenCalledWith(
  expect.objectContaining({
    prompt: expect.stringContaining('Generate a summary')
  })
);

// Check specific call (0-indexed)
expect(mockClient.generateObject).toHaveBeenNthCalledWith(
  1,
  expect.objectContaining({
    prompt: expect.stringContaining('first prompt')
  })
);
```

## Testing Patterns

### Testing Success Cases

Focus on what the brain produces for the user:

```typescript
it('should generate personalized recommendations', async () => {
  // Arrange
  mockClient.mockResponses(
    { preferences: ['tech', 'sports'], confidence: 0.9 },
    { recommendations: ['Item A', 'Item B', 'Item C'] }
  );

  // Act
  const result = await runBrainTest(recommendationBrain, {
    client: mockClient,
    initialState: { userId: '123' }
  });

  // Assert outcomes, not implementation
  expect(result.completed).toBe(true);
  expect(result.finalState.recommendations).toHaveLength(3);
  expect(result.finalState.confidence).toBeGreaterThan(0.8);
});
```

### Testing Error Cases

To test error handling, create a mock client that throws:

```typescript
it('should handle API failures gracefully', async () => {
  // Arrange - create a mock that throws on the first call
  const errorClient = {
    generateObject: jest.fn().mockRejectedValue(
      new Error('Service temporarily unavailable')
    )
  };

  // Act
  const result = await runBrainTest(processingBrain, { client: errorClient });

  // Assert
  expect(result.completed).toBe(false);
  expect(result.error?.message).toBe('Service temporarily unavailable');
});
```

### Testing State Flow

Verify that data flows correctly through your brain:

```typescript
it('should use customer data to generate personalized content', async () => {
  // Arrange
  const customerName = 'Alice';
  const mockClient = createMockClient();
  mockClient.mockResponses(
    { greeting: 'Hello Alice!', tone: 'friendly' },
    { email: 'Personalized email content...' }
  );

  // Act
  const result = await runBrainTest(emailBrain, {
    client: mockClient,
    initialState: { customerName }
  });

  // Assert that the AI used the customer data
  expect(mockClient.generateObject).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: expect.stringContaining(customerName)
    })
  );
  expect(result.finalState.email).toContain('Personalized email content');
});
```

## Best Practices

1. **Test Behavior, Not Implementation**
   - ✅ Test what the brain produces
   - ❌ Don't test internal event sequences
   - ❌ Don't test step counts unless it's a user requirement

2. **Use Descriptive Test Names**
   - ✅ `it('should generate a summary from user feedback')`
   - ❌ `it('should complete 4 steps and emit events')`

3. **Keep Tests Simple**
   - Arrange: Set up mock responses
   - Act: Run the brain
   - Assert: Check the outcome

4. **Test Edge Cases That Matter**
   - API errors
   - Empty responses
   - Invalid data that could affect users

## What Not to Test

Following testing best practices, avoid testing:

1. **Implementation Details**
   - Don't check specific event types
   - Don't verify internal state transformations
   - Don't count patch operations

2. **Framework Behavior**
   - Trust that the brain framework works
   - Don't test that steps execute in order
   - Don't verify event emission

3. **Mock Behavior**
   - Don't test that mocks were called (unless verifying data flow)
   - Focus on what the brain does with the responses

## Complete Example

```typescript
import { createMockClient, runBrainTest } from './test-utils.js';
import analysisBrain from '../brains/analysis-brain.js';

describe('analysis-brain', () => {
  it('should analyze customer feedback and generate insights', async () => {
    // Arrange: Set up AI to return analysis
    const mockClient = createMockClient();
    mockClient.mockResponses({
      sentiment: 'positive',
      keywords: ['innovation', 'quality', 'service'],
      summary: 'Customers appreciate product quality and innovation'
    });

    // Act: Run analysis on customer feedback
    const result = await runBrainTest(analysisBrain, {
      client: mockClient,
      initialState: {
        feedback: 'Your product is innovative and high quality...'
      }
    });

    // Assert: Verify we got actionable insights
    expect(result.completed).toBe(true);
    expect(result.finalState.insights).toEqual({
      sentiment: 'positive',
      topThemes: ['innovation', 'quality', 'service'],
      actionable: true,
      summary: 'Customers appreciate product quality and innovation'
    });
  });

  it('should handle analysis service outages', async () => {
    // Arrange: Simulate service failure
    const errorClient = {
      generateObject: jest.fn().mockRejectedValue(
        new Error('Analysis service unavailable')
      )
    };

    // Act: Attempt analysis
    const result = await runBrainTest(analysisBrain, {
      client: errorClient,
      initialState: { feedback: 'Some feedback...' }
    });

    // Assert: Verify graceful failure
    expect(result.completed).toBe(false);
    expect(result.error?.message).toBe('Analysis service unavailable');
  });
});
```

## Troubleshooting

### TypeScript Issues

The test utilities are fully typed. If you get type errors:
```typescript
// ✅ Type-safe: result.finalState is typed as your brain's state
const result = await runBrainTest(myBrain, { initialState });
expect(result.finalState.myProperty).toBe('value');
```

### Common Issues

1. **Mock count mismatch**: Ensure you mock the same number of responses as AI calls in your brain
2. **State assertions failing**: Check that your brain is actually setting the expected state
3. **Completion is false**: Your brain might be throwing an error - check `result.error`

### Debugging Tips

```typescript
// See what prompts were sent to AI
const calls = mockClient.generateObject.mock.calls;
console.log('AI prompts:', calls.map(c => c[0].prompt));

// Check events that occurred during execution
console.log('Events:', result.events.map(e => e.type));
```

## Next Steps

- Review the [Brain DSL Guide](./brain-dsl-guide.md) for more information on brain structure
- Check example tests in the codebase for real-world testing patterns
- Remember: focus on testing what matters to users, not how the brain works internally