# Brain DSL User Guide

This guide explains how to use the Positronic Brain DSL to create AI-powered workflows.

## Overview

The Brain DSL provides a fluent, type-safe API for building stateful AI workflows. Brains are composed of steps that transform state, with full TypeScript type inference throughout the chain.

**Note**: This project uses a custom brain function. Always import `brain` from `./brain.js`, not from `@positronic/core`. See the [Positronic Guide](./positronic-guide.md) for details.

## Basic Brain Structure

```typescript
import { brain } from './brain.js';
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
- The `template` function receives the current state and resources, returning the prompt string
- Templates can be async to load resources: `async (state, resources) => { ... }`
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

The `withServices` method provides dependency injection for your brains, making external services available throughout the workflow while maintaining testability.

#### Basic Usage

```typescript
interface MyServices {
  logger: Logger;
  database: Database;
}

const brainWithServices = brain('Service Brain')
  .withServices<MyServices>({ logger, database })
  .step('Log and Save', async ({ state, logger, database }) => {
    logger.info('Processing state');
    await database.save(state);
    return state;
  });
```

#### Where Services Are Available

Services are destructured alongside other parameters in:

1. **Step Actions**:
```typescript
.step('Process', ({ state, logger, database }) => {
  logger.info('Step executing');
  return state;
})
```

2. **Prompt Reduce Functions**:
```typescript
.prompt('Generate', {
  template: (state) => 'Generate something',
  outputSchema: { schema, name: 'result' as const }
}, async ({ state, response, logger, database }) => {
  logger.info('Saving AI response');
  await database.save({ ...state, result: response });
  return state;
})
```

3. **Nested Brain Reducers**:
```typescript
.brain('Run Sub-Brain', subBrain, ({ state, brainState, logger }) => {
  logger.info('Sub-brain completed');
  return { ...state, subResult: brainState };
})
```

#### Real-World Example

```typescript
// Define service interfaces
interface Services {
  api: {
    fetchData: (id: string) => Promise<Data>;
    submitResult: (result: any) => Promise<void>;
  };
  cache: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
  };
  metrics: {
    track: (event: string, properties?: any) => void;
    time: (label: string) => () => void;
  };
}

// Create a brain with multiple services
const analysisBrain = brain('Data Analysis')
  .withServices<Services>({
    api: apiClient,
    cache: redisClient,
    metrics: analyticsClient
  })
  .step('Start Timing', ({ metrics }) => {
    const endTimer = metrics.time('analysis_duration');
    return { startTime: Date.now(), endTimer };
  })
  .step('Check Cache', async ({ state, cache, metrics }) => {
    const cached = await cache.get('analysis_result');
    metrics.track('cache_check', { hit: !!cached });
    return { ...state, cached, fromCache: !!cached };
  })
  .step('Fetch If Needed', async ({ state, api }) => {
    if (state.fromCache) return state;
    const data = await api.fetchData('latest');
    return { ...state, data };
  })
  .prompt('Analyze Data', {
    template: ({ data }) => <%= "`Analyze this data: ${JSON.stringify(data)}`" %>,
    outputSchema: {
      schema: z.object({
        insights: z.array(z.string()),
        confidence: z.number()
      }),
      name: 'analysis' as const
    }
  })
  .step('Save Results', async ({ state, api, cache, metrics }) => {
    // Save to cache for next time
    await cache.set('analysis_result', state.analysis);
    
    // Submit to API
    await api.submitResult(state.analysis);
    
    // Track completion
    state.endTimer(); // End the timer
    metrics.track('analysis_complete', {
      insights_count: state.analysis.insights.length,
      confidence: state.analysis.confidence,
      from_cache: state.fromCache
    });
    
    return state;
  });
```

#### Testing with Services

Services make testing easier by allowing you to inject mocks:

```typescript
// In your test file
import { createMockClient, runBrainTest } from '@positronic/core/testing';

const mockLogger = {
  info: jest.fn(),
  error: jest.fn()
};

const mockDatabase = {
  save: jest.fn().mockResolvedValue(undefined),
  find: jest.fn().mockResolvedValue({ id: '123', name: 'Test' })
};

const testBrain = brain('Test Brain')
  .withServices({ logger: mockLogger, database: mockDatabase })
  .step('Do Something', async ({ logger, database }) => {
    logger.info('Fetching data');
    const data = await database.find('123');
    return { data };
  });

// Run test
const result = await runBrainTest(testBrain, {
  client: createMockClient()
});

// Verify service calls
expect(mockLogger.info).toHaveBeenCalledWith('Fetching data');
expect(mockDatabase.find).toHaveBeenCalledWith('123');
expect(result.finalState.data).toEqual({ id: '123', name: 'Test' });
```

#### Important Notes

- Call `withServices` before defining any steps
- Services are typed - TypeScript knows exactly which services are available
- Services are not serialized - they're for side effects and external interactions
- Each brain instance maintains its own service references

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

Resources are also available in prompt templates:

```typescript
brain('Template Example').prompt('Generate Content', {
  template: async (state, resources) => {
    const template = await resources.prompts.customerSupport.loadText();
    return template.replace('{{issue}}', state.issue);
  },
  outputSchema: {
    schema: z.object({ response: z.string() }),
    name: 'supportResponse' as const,
  },
});
```

## Organizing Complex Prompts

When prompts become more than a sentence or two, extract them into separate files for better maintainability:

### File Structure

For complex brains, organize your code into folders:

```
brains/
├── hn-bot/
│   ├── brain.ts           # Main brain definition
│   └── ai-filter-prompt.ts # Complex prompt configuration
└── simple-bot.ts          # Simple brains can stay as single files
```

### Extracting Prompts

When you extract a prompt to a separate file, you'll need to explicitly specify the state type:

```typescript
// brains/hn-bot/ai-filter-prompt.ts
import { z } from 'zod';
import type { Resources } from '@positronic/core';

// Define the state type that this prompt expects, only what the prompt needs
interface FilterPromptState {
  articles: Array<{
    title: string;
    url: string;
    score: number;
  }>;
  userPreferences?: string;
}

// Export the prompt configuration
export const aiFilterPrompt = {
  template: async (state: FilterPromptState, resources: Resources) => {
    // Load a prompt template from resources
    const template = await resources.prompts.hnFilter.loadText();

    // Build the prompt with state data
    const articleList = state.articles
      .map((a, i) => <%= "`${i + 1}. ${a.title} (score: ${a.score})`" %>)
      .join('\n');

    return template
      .replace('{{articleList}}', articleList)
      .replace('{{preferences}}', state.userPreferences || 'No specific preferences');
  },
  outputSchema: {
    schema: z.object({
      selectedArticles: z.array(z.number()).describe('Indices of selected articles'),
      reasoning: z.string().describe('Brief explanation of selections'),
    }),
    name: 'filterResults' as const,
  },
};

// brains/hn-bot/brain.ts
import { brain } from '../brain.js';
import { aiFilterPrompt } from './ai-filter-prompt.js';

export default brain('HN Article Filter')
  .step('Fetch Articles', async ({ state }) => {
    // Fetch Hacker News articles
    const articles = await fetchHNArticles();
    return { articles };
  })
  .prompt('Filter Articles', aiFilterPrompt)
  .step('Format Results', ({ state }) => ({
    selectedArticles: state.filterResults.selectedArticles.map(
      i => state.articles[i]
    ),
    reasoning: state.filterResults.reasoning,
  }));
```

### Benefits of This Approach

1. **Separation of Concerns**: Prompt logic is isolated from brain flow
2. **Reusability**: Prompts can be shared between different brains
3. **Testability**: Prompts can be unit tested independently
4. **Type Safety**: Explicit types ensure correct state shape
5. **Resource Management**: Complex prompts often load templates from resources

### When to Extract Prompts

Extract prompts to separate files when:
- The template is more than 2-3 lines
- The prompt uses complex logic or formatting
- You need to load resources or templates
- The prompt might be reused in other brains
- You want to test the prompt logic separately

## Best Practices

1. **Immutable State Updates**: Always return new state objects
2. **Type Safety**: Use `as const` for schema names in prompt steps
3. **Error Handling**: Handle errors via events, not try/catch
4. **Services**: Inject services for side effects (logging, database, etc.)
5. **Composition**: Break complex workflows into smaller, reusable brains
6. **Testing**: Mock the client and collect all events before assertions
7. **Prompt Organization**: Extract complex prompts (more than a sentence or two) to separate files
8. **Resource Templates**: Use resources for prompt templates that can be edited without changing code

## Complete Example

```typescript
import { brain } from './brain.js';
import { BrainRunner } from '@positronic/core';
import { z } from 'zod';

// Define services
interface Services {
  logger: Logger;
  analytics: {
    track: (event: string, properties?: any) => void;
  };
}

// Create brain with all features
const completeBrain = brain({
  title: 'Complete Example',
  description: 'Demonstrates all Brain DSL features',
})
  .withOptions({ temperature: 0.7 })
  .withServices<Services>({ 
    logger: console,
    analytics: {
      track: (event, props) => console.log('Track:', event, props)
    }
  })
  .step('Initialize', ({ logger, analytics }) => {
    logger.log('Starting workflow');
    analytics.track('brain_started');
    return { startTime: Date.now() };
  })
  .prompt('Generate Plan', {
    template: async (state, resources) => {
      // Load a template from resources
      const template = await resources.templates.projectPlan.loadText();
      return template.replace('{{context}}', 'software project');
    },
    outputSchema: {
      schema: z.object({
        tasks: z.array(z.string()),
        duration: z.number(),
      }),
      name: 'plan' as const,
    },
  }, 
  // Services available in reduce function too
  ({ state, response, logger }) => {
    logger.log(<%= "`Plan generated with ${response.tasks.length} tasks`" %>);
    return { ...state, plan: response };
  })
  .step('Process Plan', ({ state, logger, analytics }) => {
    logger.log(<%= "`Processing ${state.plan.tasks.length} tasks`" %>);
    analytics.track('plan_processed', {
      task_count: state.plan.tasks.length,
      duration: state.plan.duration
    });
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
