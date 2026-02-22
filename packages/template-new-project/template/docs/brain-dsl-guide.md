# Brain DSL User Guide

This guide explains how to use the Positronic Brain DSL to create AI-powered workflows.

## Overview

The Brain DSL provides a fluent, type-safe API for building stateful AI workflows. Brains are composed of steps that transform state, with full TypeScript type inference throughout the chain.

**Note**: This project uses a custom brain function. Always import `brain` from `../brain.js`, not from `@positronic/core`. See positronic-guide.md for details.

### Type Safety and Options

The brain function provides full type safety through its fluent API. State types are automatically inferred as you build your brain, and options can be validated at runtime using schemas.

For runtime options validation, use the `withOptionsSchema` method with a Zod schema:

```typescript
import { z } from 'zod';

const optionsSchema = z.object({
  environment: z.enum(['dev', 'staging', 'prod']),
  verbose: z.boolean().default(false)
});

const myBrain = brain('My Brain')
  .withOptionsSchema(optionsSchema)
  .step('Process', ({ options }) => {
    // options is fully typed based on the schema
    if (options.verbose) {
      console.log('Running in', options.environment);
    }
    return { status: 'complete' };
  });
```

## Basic Brain Structure

```typescript
import { brain } from '../brain.js';
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
      `<%= '${context}' %>. Please provide a brief, beginner-friendly explanation of <%= '${topic}' %>.`,
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
      summary: `This explanation covers <%= '${state.topicExplanation.keyPoints?.length || 0}' %> key points at a <%= '${state.topicExplanation.difficulty || \'unknown\'}' %> level.`,
      points: state.topicExplanation.keyPoints || [],
    },
  }))
  .prompt(
    'Generate follow-up questions',
    {
      template: ({ formattedOutput }) =>
        `Based on this explanation about <%= '${formattedOutput.topic}' %>: "<%= '${formattedOutput.explanation}' %>"
        
        Generate 3 thoughtful follow-up questions that a student might ask.`,
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

## Guard Clauses

Use `.guard()` to short-circuit a brain when a condition isn't met. If the predicate returns `true`, execution continues normally. If it returns `false`, all remaining steps are skipped and the brain completes with the current state.

```typescript
brain('email-checker')
  .step('Check Emails', async ({ state, client }) => {
    const emails = await analyzeEmails(client, state);
    return { ...state, emails };
  })
  .guard(({ state }) => state.emails.some(e => e.important))
  // everything below only runs if guard passes
  .ui('Review emails', { ... })
  .step('Notify and wait', ...)
  .step('Handle response', ...);
```

Key points:
- The predicate is synchronous and receives `{ state, options }`
- Returns `true` to continue, `false` to skip all remaining steps
- The guard doesn't transform state — if you need to set "early exit" fields, do it in the step before the guard
- State type is unchanged after a guard (subsequent steps see the same type)
- Multiple guards can be chained — the first one that fails skips everything after it
- Halted steps appear as "halted" in the CLI watch view
- An optional title can be passed as the second argument: `.guard(predicate, 'Check emails exist')`

### Multiple Guards

```typescript
brain('processor')
  .step('Init', () => ({ data: [], validated: false }))
  .guard(({ state }) => state.data.length > 0, 'Has data')
  .step('Validate', ({ state }) => ({ ...state, validated: true }))
  .guard(({ state }) => state.validated, 'Is valid')
  .step('Process', ({ state }) => ({ ...state, processed: true }));
```

## Step Parameters

Each step receives these parameters:

- `state` - Current state (type-inferred from previous steps)
- `client` - AI client for generating structured objects
- `resources` - Loaded resources (files, documents, etc.)
- `options` - Runtime options passed to the brain
- `response` - Webhook response data (available after `.wait()` completes)
- `page` - Generated page object (available after `.ui()` step)
- `pages` - Pages service for HTML page management
- `env` - Runtime environment containing `origin` (base URL) and `secrets` (typed secrets object)
- Custom services (if configured with `.withServices()` or `createBrain()`)

## Configuration Methods

### Brain Options

Options provide runtime configuration for your brains, allowing different behavior without changing code. They're perfect for settings like API endpoints, feature flags, output preferences, or channel identifiers.

#### Typing Options

To use options in your brain, define a Zod schema with `withOptionsSchema`:

```typescript
import { z } from 'zod';

// Define your options schema
const notificationSchema = z.object({
  slackChannel: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  includeTimestamp: z.boolean().default(true)
});

// Use withOptionsSchema to add runtime validation
const notificationBrain = brain('Notification Brain')
  .withOptionsSchema(notificationSchema)
  .step('Send Alert', async ({ state, options, slack }) => {
    // TypeScript knows the exact shape of options from the schema
    const message = options.includeTimestamp 
      ? `[<%= '${new Date().toISOString()}' %>] <%= '${state.alert}' %>`
      : state.alert;
    
    await slack.post(options.slackChannel, {
      text: message,
      priority: options.priority  // Type-safe: must be 'low' | 'normal' | 'high'
    });
    
    return state;
  });
```

The schema approach provides:
- Runtime validation of options
- Automatic TypeScript type inference
- Clear error messages for invalid options
- Support for default values in the schema

#### Passing Options from Command Line

Override default options when running brains from the CLI using the `-o` or `--options` flag:

```bash
# Single option
px brain run my-brain -o debug=true

# Multiple options
px brain run my-brain -o slackChannel=#alerts -o temperature=0.9 -o verbose=true

# Options with spaces or special characters (use quotes)
px brain run my-brain -o "webhook=https://example.com/api?key=value"
```

Options are passed as simple key=value pairs and are available as strings in your brain.

#### Options vs Services vs Initial State

Understanding when to use each:

- **Options**: Runtime configuration (channels, endpoints, feature flags)
  - Override from CLI with `-o key=value`
  - Don't change during execution
  - Examples: `slackChannel`, `apiEndpoint`, `debugMode`

- **Services**: External dependencies and side effects (clients, loggers, databases)
  - Configure once with `.withServices()`
  - Available in all steps
  - Not serializable
  - Examples: `slackClient`, `database`, `logger`

- **Initial State**: Starting data for a specific run
  - Pass to `brain.run()` or set via CLI/API
  - Changes throughout execution
  - Must be serializable
  - Examples: `userId`, `orderData`, `inputText`

#### Real-World Example

```typescript
// Define a brain that uses options for configuration
const notificationSchema = z.object({
  channel: z.string(),
  priority: z.string().default('normal'),
  includeDetails: z.string().default('false')
});

const notificationBrain = brain('Smart Notifier')
  .withOptionsSchema(notificationSchema)
  .withServices({ 
    slack: slackClient,
    email: emailClient 
  })
  .step('Process Alert', ({ state, options }) => ({
    ...state,
    formattedMessage: options.includeDetails === 'true'
      ? `Alert: <%= '${state.message}' %> - Details: <%= '${state.details}' %>`
      : `Alert: <%= '${state.message}' %>`,
    isPriority: options.priority === 'high'
  }))
  .step('Send Notification', async ({ state, options, slack, email }) => {
    // Use options to control behavior
    if (state.isPriority) {
      // High priority goes to email too
      await email.send('admin@example.com', state.formattedMessage);
    }
    
    // Always send to Slack channel from options
    await slack.post(options.channel, state.formattedMessage);
    
    return { ...state, notified: true };
  });

// Run with custom options from CLI:
// px brain run smart-notifier -o channel=#urgent -o priority=high -o includeDetails=true
```

#### Testing with Options

```typescript
// In your tests
const result = await runBrainTest(notificationBrain, {
  client: mockClient,
  initialState: { message: 'System down', details: 'Database unreachable' },
  options: { 
    channel: '#test-channel',
    priority: 'high',
    includeDetails: true
  }
});

expect(mockSlack.post).toHaveBeenCalledWith('#test-channel', expect.any(String));
expect(mockEmail.send).toHaveBeenCalled(); // High priority triggers email
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
    template: ({ data }) => `Analyze this data: <%= '${JSON.stringify(data)}' %>`,
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
import { createMockClient, runBrainTest } from '../tests/test-utils.js';

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

### Tool Configuration with `withTools()`

The `withTools()` method registers tools that can be used by agent steps:

```typescript
import { z } from 'zod';

const brainWithTools = brain('Tool Brain')
  .withTools({
    fetchData: {
      description: 'Fetch data from an external API',
      inputSchema: z.object({
        endpoint: z.string(),
        params: z.record(z.string()).optional()
      }),
      execute: async ({ endpoint, params }) => {
        const url = new URL(endpoint);
        if (params) {
          Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        }
        const response = await fetch(url);
        return response.json();
      }
    },
    saveToDatabase: {
      description: 'Save data to the database',
      inputSchema: z.object({
        table: z.string(),
        data: z.any()
      }),
      execute: async ({ table, data }) => {
        // Database save logic
        return { success: true, id: 'generated-id' };
      }
    }
  })
  .brain('Data Agent', {
    system: 'You can fetch and save data.',
    prompt: 'Fetch user data and save the summary.'
    // Tools defined with withTools() are automatically available
  });
```

### Component Configuration with `withComponents()`

The `withComponents()` method registers custom UI components for use in `.ui()` steps:

```typescript
const brainWithComponents = brain('Custom UI Brain')
  .withComponents({
    CustomCard: {
      description: 'A styled card component for displaying content',
      props: z.object({
        title: z.string(),
        content: z.string(),
        variant: z.enum(['default', 'highlighted', 'warning']).default('default')
      }),
      render: (props) => `
        <div class="card card-<%= '${props.variant}' %>">
          <h3><%= '${props.title}' %></h3>
          <p><%= '${props.content}' %></p>
        </div>
      `
    },
    DataTable: {
      description: 'A table for displaying structured data',
      props: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string()))
      }),
      render: (props) => {
        // Build table HTML from headers and rows
        const headerRow = props.headers.map(h => '<th>' + h + '</th>').join('');
        const bodyRows = props.rows.map(row =>
          '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>'
        ).join('');
        return '<table><thead><tr>' + headerRow + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
      }
    }
  })
  .ui('Dashboard', {
    template: (state) => `
      Create a dashboard using CustomCard components to display:
      - User name: <%= '${state.userName}' %>
      - Account status: <%= '${state.status}' %>
      Use DataTable to show recent activity.
    `,
    responseSchema: z.object({
      acknowledged: z.boolean()
    })
  });
```

### Using `createBrain()` for Project Configuration

For project-wide configuration, use `createBrain()` in your `brain.ts` file:

```typescript
// brain.ts
import { createBrain } from '@positronic/core';
import { z } from 'zod';

export const brain = createBrain({
  services: {
    logger: console,
    api: apiClient
  },
  tools: {
    search: {
      description: 'Search the web',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => searchWeb(query)
    }
  },
  components: {
    Alert: {
      description: 'Alert banner',
      props: z.object({ message: z.string(), type: z.enum(['info', 'warning', 'error']) }),
      render: (props) => `<div class="alert alert-<%= '${props.type}' %>"><%= '${props.message}' %></div>`
    }
  }
});
```

All brains created with this factory will have access to the configured services, tools, and components.

## Running Brains

### Basic Execution

```typescript
const myBrain = brain('Simple').step('Process', () => ({ result: 'done' }));

// Run and collect events
for await (const event of myBrain.run({ client: aiClient })) {
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
    message: `<%= '${state.name}' %>: <%= '${state.count}' %>`, // Both properties available
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
      .map((a, i) => `<%= '${i + 1}' %>. <%= '${a.title}' %> (score: <%= '${a.score}' %>)`)
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

### When to Extract Prompts

Extract prompts to separate files when:
- The template is more than 2-3 lines
- The prompt uses complex logic or formatting
- You need to load resources or templates
- The prompt might be reused in other brains
- You want to test the prompt logic separately

## Batch Prompt Mode

When you need to run the same prompt over multiple items, use batch mode with the `over` option:

```typescript
brain('Batch Processor')
  .step('Initialize', () => ({
    items: [
      { id: 1, title: 'First item' },
      { id: 2, title: 'Second item' },
      { id: 3, title: 'Third item' }
    ]
  }))
  .prompt('Summarize Items', {
    template: (item) => `Summarize this item: <%= '${item.title}' %>`,
    outputSchema: {
      schema: z.object({ summary: z.string() }),
      name: 'summaries' as const
    }
  }, {
    over: (state) => state.items,  // Array to iterate over
    concurrency: 10,               // Parallel requests (default: 10)
    error: (item, error) => ({ summary: 'Failed to summarize' })  // Fallback on error
  })
  .step('Process Results', ({ state }) => ({
    ...state,
    // summaries is [item, response][] - array of tuples
    processedSummaries: state.summaries.map(([item, response]) => ({
      id: item.id,
      summary: response.summary
    }))
  }));
```

### Batch Options

- `over: (state) => T[]` - Function returning the array to iterate over
- `concurrency: number` - Maximum number of items processed in parallel (default: 10). The framework automatically handles rate limit retries with exponential backoff.
- `error: (item, error) => Response` - Fallback function when a request fails

### Result Format

The result is stored as an array of `[item, response]` tuples, preserving the relationship between each input item and its generated response.

## Agent Steps

For complex AI workflows that require tool use, use the `.brain()` method with an agent configuration:

```typescript
brain('Research Assistant')
  .step('Initialize', () => ({
    query: 'What are the latest developments in AI?'
  }))
  .brain('Research Agent', {
    system: 'You are a helpful research assistant with access to search tools.',
    prompt: ({ query }) => `Research this topic: <%= '${query}' %>`,
    tools: {
      search: {
        description: 'Search the web for information',
        inputSchema: z.object({
          query: z.string().describe('The search query')
        }),
        execute: async ({ query }) => {
          // Implement search logic
          const results = await searchWeb(query);
          return { results };
        }
      },
      summarize: {
        description: 'Summarize a piece of text',
        inputSchema: z.object({
          text: z.string().describe('Text to summarize')
        }),
        execute: async ({ text }) => {
          return { summary: text.slice(0, 100) + '...' };
        }
      }
    },
    maxTokens: 10000,
  })
  .step('Format Results', ({ state, brainState }) => ({
    ...state,
    researchResults: brainState.response
  }));
```

### Agent Configuration Options

- `system: string` - System prompt for the agent
- `prompt: string | ((state) => string)` - User prompt (can be a function)
- `tools: Record<string, ToolDefinition>` - Tools available to the agent
- `outputSchema: { schema, name }` - Structured output schema (see below)
- `maxTokens: number` - Maximum tokens for the agent response
- `maxIterations: number` - Maximum agent loop iterations (default: 100)

### Tool Definition

Each tool requires:
- `description: string` - What the tool does
- `inputSchema: ZodSchema` - Zod schema for the tool's input
- `execute: (input, context) => Promise<any>` - Function to execute when the tool is called
- `terminal?: boolean` - If true, calling this tool ends the agent loop

### Tool Webhooks (waitFor)

Tools can pause agent execution and wait for external events by returning `{ waitFor: webhook(...) }` from their `execute` function. This is useful for human-in-the-loop workflows where the agent needs to wait for approval, external API callbacks, or other asynchronous events.

```typescript
import approvalWebhook from '../webhooks/approval.js';

brain('Support Ticket Handler')
  .brain('Handle Support Request', {
    system: 'You are a support agent. Escalate complex issues for human review.',
    prompt: ({ ticket }) => `Handle this support ticket: <%= '${ticket.description}' %>`,
    tools: {
      escalateToHuman: {
        description: 'Escalate the ticket to a human reviewer for approval',
        inputSchema: z.object({
          summary: z.string().describe('Summary of the issue'),
          recommendation: z.string().describe('Your recommended action'),
        }),
        execute: async ({ summary, recommendation }, context) => {
          // Send notification to human reviewer (e.g., via Slack, email)
          await notifyReviewer({ summary, recommendation, ticketId: context.state.ticketId });

          // Return waitFor to pause until the webhook fires
          return {
            waitFor: approvalWebhook(context.state.ticketId),
          };
        },
      },
      resolveTicket: {
        description: 'Mark the ticket as resolved',
        inputSchema: z.object({
          resolution: z.string().describe('How the ticket was resolved'),
        }),
        terminal: true,
      },
    },
  })
  .step('Process Result', ({ state, response }) => ({
    ...state,
    // response contains the webhook data (e.g., { approved: true, reviewerNote: '...' })
    approved: response?.approved,
    reviewerNote: response?.reviewerNote,
  }));
```

Key points about tool `waitFor`:
- Return `{ waitFor: webhook(...) }` to pause the agent and wait for an external event
- The webhook response is available in the next step via the `response` parameter
- You can wait for multiple webhooks (first response wins): `{ waitFor: [webhook1(...), webhook2(...)] }`
- The `execute` function receives a `context` parameter with access to `state`, `options`, `env`, etc.
- Use this pattern for approvals, external API callbacks, or any human-in-the-loop workflow

### Agent Output Schema

Use `outputSchema` to get structured, typed output from agent steps. This generates a terminal tool that the agent must call to complete, ensuring the output matches your schema:

```typescript
brain('Entity Extractor')
  .brain('Extract Entities', {
    system: 'You are an entity extraction assistant.',
    prompt: 'Extract all people and organizations from the provided text.',
    outputSchema: {
      schema: z.object({
        people: z.array(z.string()).describe('Names of people mentioned'),
        organizations: z.array(z.string()).describe('Organization names'),
        confidence: z.number().min(0).max(1).describe('Confidence score'),
      }),
      name: 'entities' as const,  // Use 'as const' for type inference
    },
  })
  .step('Use Extracted Data', ({ state }) => {
    // TypeScript knows state.entities has people, organizations, and confidence
    console.log('Found ' + state.entities.people.length + ' people');
    console.log('Found ' + state.entities.organizations.length + ' organizations');
    return {
      ...state,
      summary: 'Extracted ' + state.entities.people.length + ' people and ' +
               state.entities.organizations.length + ' organizations',
    };
  });
```

Key points about `outputSchema`:
- The agent automatically gets a `done` tool that uses your schema
- The result is stored under `state[name]` (e.g., `state.entities`)
- Full TypeScript type inference flows to subsequent steps
- Use `as const` on the name for proper type narrowing

## Environment and Pages Service

### The `env` Parameter

Steps have access to the runtime environment via the `env` parameter:

```typescript
brain('Environment Example')
  .step('Use Environment', ({ state, env }) => {
    // env.origin - Base URL of the deployment
    console.log('Running at:', env.origin);

    // env.secrets - Type-augmented secrets object
    const apiKey = env.secrets.EXTERNAL_API_KEY;

    return {
      ...state,
      baseUrl: env.origin,
      configured: true
    };
  });
```

### The `pages` Service

The `pages` service allows you to create and manage HTML pages programmatically:

```typescript
brain('Page Creator')
  .step('Create Custom Page', async ({ state, pages, env }) => {
    // Create a page with HTML content
    const page = await pages.create(
      `<html>
        <body>
          <h1>Hello, <%= '${state.userName}' %>!</h1>
          <p>Your dashboard is ready.</p>
        </body>
      </html>`,
      { persist: true }  // Keep the page after brain completes
    );

    return {
      ...state,
      dashboardUrl: page.url,      // URL where users can view the page
      pageWebhook: page.webhook    // Webhook for form submissions (if any)
    };
  })
  .step('Notify User', async ({ state, slack }) => {
    await slack.post('#general', `Your dashboard: <%= '${state.dashboardUrl}' %>`);
    return state;
  });
```

### Page Options

- `persist: boolean` - If true, the page remains accessible after the brain completes

### Page Object

The created page object contains:
- `url: string` - Public URL to access the page
- `webhook: WebhookConfig` - Webhook configuration for handling form submissions

### Custom Pages with Forms (CSRF Token)

When building custom HTML pages with forms, you must include a CSRF token to prevent unauthorized submissions. The `.ui()` step handles this automatically, but custom pages require manual setup. This applies whether you submit to the built-in `ui-form` endpoint or to a custom webhook.

#### Using a Custom Webhook

If your page submits to a custom webhook (e.g., `/webhooks/archive`), pass the token as the second argument when creating the webhook registration:

```typescript
import { generateFormToken } from '@positronic/core';
import archiveWebhook from '../webhooks/archive.js';

brain('Archive Workflow')
  .step('Create Page', async ({ state, pages, env }) => {
    const formToken = generateFormToken();

    const html = `<html>
      <body>
        <form method="POST" action="<%= '${env.origin}' %>/webhooks/archive">
          <input type="hidden" name="__positronic_token" value="<%= '${formToken}' %>">
          <input type="text" name="name" placeholder="Your name">
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>`;

    await pages.create('my-page', html);
    return { ...state, formToken };
  })
  .wait('Wait for submission', ({ state }) => archiveWebhook(state.sessionId, state.formToken))
  .step('Process', ({ state, response }) => ({
    ...state,
    name: response.name,
  }));
```

#### Using the System `ui-form` Endpoint

If your page submits to the built-in `ui-form` endpoint, include the token in the webhook registration object:

```typescript
import { generateFormToken } from '@positronic/core';

brain('Custom Form')
  .step('Create Form Page', async ({ state, pages, env }) => {
    const formToken = generateFormToken();
    const webhookIdentifier = `custom-form-<%= '${Date.now()}' %>`;
    const formAction = `<%= '${env.origin}' %>/webhooks/system/ui-form?identifier=<%= '${encodeURIComponent(webhookIdentifier)}' %>`;

    const page = await pages.create('my-form', `<html>
      <body>
        <form method="POST" action="<%= '${formAction}' %>">
          <input type="hidden" name="__positronic_token" value="<%= '${formToken}' %>">
          <input type="text" name="name" placeholder="Your name">
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>`);

    return {
      ...state,
      pageUrl: page.url,
      webhook: { slug: 'ui-form', identifier: webhookIdentifier, token: formToken },
    };
  })
  .wait('Wait for form', ({ state }) => state.webhook)
  .step('Process', ({ state, response }) => ({
    ...state,
    name: response.name,
  }));
```

#### Summary

The three required pieces for any custom page with a form:
1. Call `generateFormToken()` to get a token
2. Add `<input type="hidden" name="__positronic_token" value="...">` to your form
3. Include the `token` in your webhook registration — either as the second argument to a custom webhook function (e.g., `myWebhook(identifier, token)`) or in the registration object for `ui-form`

Without a token, the server will reject the form submission.

## UI Steps

UI steps allow brains to generate dynamic user interfaces using AI. The `.ui()` step generates a page and provides a `page` object to the next step. You then notify users and use `.wait()` to pause until the form is submitted.

### Basic UI Step

```typescript
import { z } from 'zod';

brain('Feedback Collector')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John Doe',
  }))
  // Generate the form
  .ui('Collect Feedback', {
    template: (state) => `
      Create a feedback form for <%= '${state.userName}' %>.
      Include fields for rating (1-5) and comments.
    `,
    responseSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
  })
  // Notify user
  .step('Notify', async ({ state, page, slack }) => {
    await slack.post('#feedback', `Please fill out: <%= '${page.url}' %>`);
    return state;
  })
  // Wait for form submission
  .wait('Wait for submission', ({ page }) => page.webhook)
  // Process the form data (comes through response, not page)
  .step('Process Feedback', ({ state, response }) => ({
    ...state,
    feedbackReceived: true,
    rating: response.rating,     // typed from responseSchema
    comments: response.comments,
  }));
```

### How UI Steps Work

1. **Template**: The `template` function generates a prompt describing the desired UI
2. **AI Generation**: The AI creates a component tree based on the prompt
3. **Page Object**: Next step receives `page` with `url` and `webhook`
4. **Notification**: You notify users however you want (Slack, email, etc.)
5. **Wait**: Use `.wait('title', ({ page }) => page.webhook)` to pause until form submission
6. **Form Data**: Step after `.wait()` receives form data via `response`

### The `page` Object

After a `.ui()` step, the next step receives:
- `page.url` - URL where users can access the form
- `page.webhook` - Pre-configured webhook for form submissions

### Template Best Practices

Be specific about layout and content:

```typescript
.ui('Contact Form', {
  template: (state) => `
    Create a contact form with:
    - Header: "Get in Touch"
    - Name field (required)
    - Email field (required, pre-filled with "<%= '${state.email}' %>")
    - Message textarea (required)
    - Submit button labeled "Send Message"

    Use a clean, centered single-column layout.
  `,
  responseSchema: z.object({
    name: z.string(),
    email: z.string().email(),
    message: z.string(),
  }),
})
```

### Data Bindings

Use `{{path}}` syntax to bind props to runtime data:

```typescript
.ui('Order Summary', {
  template: (state) => `
    Create an order summary showing:
    - List of items from {{cart.items}}
    - Total: {{cart.total}}
    - Shipping address input
    - Confirm button
  `,
  responseSchema: z.object({
    shippingAddress: z.string(),
  }),
})
```

### Multi-Step Forms

Chain UI steps for multi-page workflows:

```typescript
brain('User Onboarding')
  .step('Start', () => ({ userData: {} }))

  // Step 1: Personal info
  .ui('Personal Info', {
    template: () => `
      Create a form for personal information:
      - First name, Last name
      - Date of birth
      - Next button
    `,
    responseSchema: z.object({
      firstName: z.string(),
      lastName: z.string(),
      dob: z.string(),
    }),
  })
  .step('Notify Personal', async ({ state, page, notify }) => {
    await notify(`Step 1: <%= '${page.url}' %>`);
    return state;
  })
  .wait('Wait for Personal', ({ page }) => page.webhook)
  .step('Save Personal', ({ state, response }) => ({
    ...state,
    userData: { ...state.userData, ...response },
  }))

  // Step 2: Preferences
  .ui('Preferences', {
    template: (state) => `
      Create preferences form for <%= '${state.userData.firstName}' %>:
      - Newsletter subscription checkbox
      - Contact preference (email/phone/sms)
      - Complete button
    `,
    responseSchema: z.object({
      newsletter: z.boolean(),
      contactMethod: z.enum(['email', 'phone', 'sms']),
    }),
  })
  .step('Notify Preferences', async ({ state, page, notify }) => {
    await notify(`Step 2: <%= '${page.url}' %>`);
    return state;
  })
  .wait('Wait for Preferences', ({ page }) => page.webhook)
  .step('Complete', ({ state, response }) => ({
    ...state,
    userData: { ...state.userData, preferences: response },
    onboardingComplete: true,
  }));
```

For more details on UI steps, see the full UI Step Guide in the main Positronic documentation.

## Complete Example

```typescript
import { brain } from '../brain.js';
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
  })
  .step('Process Plan', ({ state, logger, analytics }) => {
    logger.log(`Plan generated with <%= '${state.plan.tasks.length}' %> tasks`);
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
