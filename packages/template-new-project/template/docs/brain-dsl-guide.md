# Brain DSL User Guide

This guide explains how to use the Positronic Brain DSL to create AI-powered workflows.

## Overview

The Brain DSL provides a fluent, type-safe API for building stateful AI workflows. Brains are composed of steps that transform state, with full TypeScript type inference throughout the chain.

## Basic Brain Structure

```typescript
import { brain } from '@positronic/core';
import { z } from 'zod';

const myBrain = brain('My First Brain')
  .step('Initialize', ({ state }) => ({
    count: 0,
    message: 'Starting...',
  }))
  .step('Process', ({ state }) => ({
    ...state,
    count: state.count + 1,
    processed: true,
  }));
```

## Step Types

### 1. Basic Steps

Transform state with synchronous or asynchronous functions:

```typescript
brain('Example')
  .step('Sync Step', ({ state }) => ({
    ...state,
    updated: true,
  }))
  .step('Async Step', async ({ state, client }) => {
    const data = await fetchSomeData();
    return { ...state, data };
  });
```

### 2. Prompt Steps

Generate structured output from AI models. Here's a complete example that shows how to chain prompts:

```typescript
brain('AI Education Assistant')
  .step('Initialize', ({ state }) => ({
    ...state,
    topic: 'artificial intelligence',
    context: 'We are creating an educational example',
  }))
  .prompt('Generate explanation', {
    template: ({ topic, context }) =>
      <%= "`${context}. Please provide a brief, beginner-friendly explanation of ${topic}.`" %>,
    outputSchema: {
      schema: z.object({
        explanation: z.string().describe('A clear explanation of the topic'),
        keyPoints: z.array(z.string()).describe('3-5 key points about the topic'),
        difficulty: z.enum(['beginner', 'intermediate', 'advanced']).describe('The difficulty level'),
      }),
      name: 'topicExplanation' as const,
    },
  })
  .step('Format output', ({ state }) => ({
    ...state,
    formattedOutput: {
      topic: state.topic,
      explanation: state.topicExplanation.explanation || '',
      summary: <%= "`This explanation covers ${state.topicExplanation.keyPoints?.length || 0} key points at a ${state.topicExplanation.difficulty || 'unknown'} level.`" %>,
      points: state.topicExplanation.keyPoints || [],
    },
  }))
  .prompt(
    'Generate follow-up questions',
    {
      template: ({ formattedOutput }) =>
        <%= "`Based on this explanation about ${formattedOutput.topic}: \"${formattedOutput.explanation}\"\n        \n        Generate 3 thoughtful follow-up questions that a student might ask.`" %>,
      outputSchema: {
        schema: z.object({
          questions: z.array(z.string()).length(3).describe('Three follow-up questions'),
        }),
        name: 'followUpQuestions' as const,
      },
    },
    // Optional: Transform the response before merging with state
    ({ state, response }) => ({
      ...state,
      followUpQuestions: response.questions,
      finalOutput: {
        ...state.formattedOutput,
        questions: response.questions,
      },
    })
  );
```

Key points about prompt steps:
- The `template` function receives the current state and returns the prompt string
- `outputSchema` defines the structure using Zod schemas
- The `name` property determines where the response is stored in state
- You can optionally provide a transform function as the third parameter
- Type inference works throughout - TypeScript knows about your schema types

### 3. Nested Brains

Compose complex workflows from smaller brains:

```typescript
const subBrain = brain('Sub Process').step('Transform', ({ state }) => ({
  result: state.input * 2,
}));

const mainBrain = brain('Main Process')
  .step('Prepare', () => ({ value: 10 }))
  .brain(
    'Run Sub Process',
    subBrain,
    ({ state, brainState }) => ({
      ...state,
      processed: brainState.result,
    }),
    (state) => ({ input: state.value }) // Initial state for sub-brain
  );
```

## Step Parameters

Each step receives these parameters:

- `state` - Current state (type-inferred from previous steps)
- `client` - AI client for generating structured objects
- `resources` - Loaded resources (files, documents, etc.)
- `options` - Runtime options passed to the brain
- Custom services (if configured with `.withServices()`)

## Configuration Methods

### Default Options

Set default options for all brain runs:

```typescript
const configuredBrain = brain('My Brain')
  .withOptions({ debug: true, temperature: 0.7 })
  .step('Process', ({ state, options }) => {
    if (options.debug) console.log('Processing...');
    return state;
  });
```

### Service Injection

Inject custom services available in all steps:

```typescript
interface MyServices {
  logger: Logger;
  database: Database;
}

const brainWithServices = brain('Service Brain')
  .withServices<MyServices>({ logger, database })
  .step('Log and Save', async ({ state, services }) => {
    services.logger.info('Processing state');
    await services.database.save(state);
    return state;
  });
```

## Running Brains

### Basic Execution

```typescript
const brain = brain('Simple').step('Process', () => ({ result: 'done' }));

// Run and collect events
for await (const event of brain.run({ client: aiClient })) {
  console.log(event.type); // START, STEP_START, STEP_COMPLETE, etc.
}
```

### With Initial State

```typescript
const result = brain.run({
  client: aiClient,
  initialState: { count: 5 },
  resources: myResources,
  options: { verbose: true },
});
```

### Using BrainRunner

For production use with adapters and state management:

```typescript
import { BrainRunner } from '@positronic/core';

const runner = new BrainRunner({
  client: aiClient,
  adapters: [loggingAdapter],
  resources: resourceLoader
});

// Get final state directly
const finalState = await runner.run(myBrain, {
  initialState: { count: 0 },
  options: { debug: true }
});
```

## Type Safety

The Brain DSL provides complete type inference:

```typescript
const typedBrain = brain('Typed Example')
  .step('Init', () => ({ count: 0 }))
  .step('Add Name', ({ state }) => ({
    ...state,
    name: 'Test', // TypeScript knows state has 'count'
  }))
  .step('Use Both', ({ state }) => ({
    message: <%= "`${state.name}: ${state.count}`" %>, // Both properties available
  }));
```

## Events

Brains emit events during execution:

- `START`/`RESTART` - Brain begins execution
- `STEP_START` - Step begins
- `STEP_COMPLETE` - Step completes with state patch
- `STEP_STATUS` - Status update for all steps
- `COMPLETE` - Brain finishes successfully
- `ERROR` - Error occurred

## Error Handling

Errors in steps emit ERROR events but don't throw:

```typescript
brain('Error Example').step('May Fail', ({ state }) => {
  if (Math.random() > 0.5) {
    throw new Error('Random failure');
  }
  return state;
});

// Handle in event stream
for await (const event of brain.run({ client })) {
  if (event.type === BRAIN_EVENTS.ERROR) {
    console.error('Step failed:', event.error);
  }
}
```

## Resources

Access loaded resources with type-safe API:

```typescript
brain('Resource Example').step('Load Data', async ({ resources }) => {
  const config = await resources.config.loadText();
  const data = await resources.data.records.loadText();
  return { config: JSON.parse(config), data };
});
```

## Best Practices

1. **Immutable State Updates**: Always return new state objects
2. **Type Safety**: Use `as const` for schema names in prompt steps
3. **Error Handling**: Handle errors via events, not try/catch
4. **Services**: Inject services for side effects (logging, database, etc.)
5. **Composition**: Break complex workflows into smaller, reusable brains
6. **Testing**: Mock the client and collect all events before assertions

## Complete Example

```typescript
import { brain, BrainRunner } from '@positronic/core';
import { z } from 'zod';

// Define services
interface Services {
  logger: Logger;
}

// Create brain with all features
const completeBrain = brain({
  title: 'Complete Example',
  description: 'Demonstrates all Brain DSL features',
})
  .withOptions({ temperature: 0.7 })
  .withServices<Services>({ logger: console })
  .step('Initialize', ({ services }) => {
    services.logger.log('Starting workflow');
    return { startTime: Date.now() };
  })
  .prompt('Generate Plan', {
    template: (state) => 'Create a project plan',
    outputSchema: {
      schema: z.object({
        tasks: z.array(z.string()),
        duration: z.number(),
      }),
      name: 'plan' as const,
    },
  })
  .step('Process Plan', ({ state, services }) => {
    services.logger.log(<%= "`Generated ${state.plan.tasks.length} tasks`" %>);
    return {
      ...state,
      taskCount: state.plan.tasks.length,
      endTime: Date.now(),
    };
  });

// Run with BrainRunner
const runner = new BrainRunner({
  client: aiClient,
  adapters: [persistenceAdapter],
});

const finalState = await runner.run(completeBrain);
console.log('Completed:', finalState);
```
