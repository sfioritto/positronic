# Brain DSL User Guide

This guide explains how to use the Positronic Brain DSL to create AI-powered workflows.

## Overview

The Brain DSL provides a fluent, type-safe API for building stateful AI workflows. Brains are composed of steps that transform state, with full TypeScript type inference throughout the chain.

**Note**: This project uses a custom brain function. Always import `brain` from `../brain.js`, not from `@positronic/core`. See positronic-guide.md for details.

### Type Safety and Options

The brain function provides full type safety through its fluent API. State types are automatically inferred as you build your brain, and options can be validated at runtime using schemas.

For runtime options validation, use the `withOptions` method with a Zod schema:

```typescript
import { z } from 'zod';

const optionsSchema = z.object({
  environment: z.enum(['dev', 'staging', 'prod']),
  verbose: z.boolean().default(false)
});

const myBrain = brain('My Brain')
  .withOptions(optionsSchema)
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
    message: ({ state: { topic, context } }) =>
      `<%= '${context}' %>. Please provide a brief, beginner-friendly explanation of <%= '${topic}' %>.`,
    outputSchema: z.object({
      explanation: z.string().describe('A clear explanation of the topic'),
      keyPoints: z.array(z.string()).describe('3-5 key points about the topic'),
      difficulty: z.enum(['beginner', 'intermediate', 'advanced']).describe('The difficulty level'),
    }),
  })
  .step('Format output', ({ state }) => ({
    ...state,
    formattedOutput: {
      topic: state.topic,
      explanation: state.explanation || '',
      summary: `This explanation covers <%= '${state.keyPoints?.length || 0}' %> key points at a <%= '${state.difficulty || \'unknown\'}' %> level.`,
      points: state.keyPoints || [],
    },
  }))
  .prompt(
    'Generate follow-up questions',
    {
      message: ({ state: { formattedOutput } }) =>
        `Based on this explanation about <%= '${formattedOutput.topic}' %>: "<%= '${formattedOutput.explanation}' %>"

        Generate 3 thoughtful follow-up questions that a student might ask.`,
      outputSchema: z.object({
        questions: z.array(z.string()).length(3).describe('Three follow-up questions'),
      }),
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
- The `message` function receives the current state and resources, returning the prompt string
- The `message` function can be async to load resources: `async ({ state, resources }) => { ... }`
- `outputSchema` defines the structure using Zod schemas
- The schema result is spread directly onto state (`{ ...state, ...result }`)
- To namespace, wrap your schema in a parent key (e.g., `z.object({ plan: z.object({ ... }) })`)
- You can optionally provide a transform function as the third parameter
- Type inference works throughout - TypeScript knows about your schema types

#### Per-Step Client Overrides

You can use a different AI model for a specific prompt step by passing a `client` option. This is useful when some steps need a cheaper model for simple tasks and others need a more capable model for complex reasoning:

```typescript
import { createAnthropicClient } from '@positronic/client-anthropic';

const fastModel = createAnthropicClient({ model: 'claude-haiku-4-5-20251001' });
const smartModel = createAnthropicClient({ model: 'claude-sonnet-4-5-20250929' });

brain('Multi-Model Brain')
  .prompt('Quick summary', {
    message: ({ state: { document } }) => `Summarize this briefly: <%= '${document}' %>`,
    outputSchema: z.object({ summary: z.string() }),
    client: fastModel,  // Use a fast, cheap model for summarization
  })
  .prompt('Deep analysis', {
    message: ({ state: { summary } }) =>
      `Analyze the implications of this summary: <%= '${summary}' %>`,
    outputSchema: z.object({
      insights: z.array(z.string()),
      risks: z.array(z.string()),
    }),
    client: smartModel,  // Use a more capable model for analysis
  });
```

When deployed to Cloudflare, rate limiting is applied automatically to all clients — including per-step overrides — through the Governor system. Brain authors don't need to worry about rate limiting.

### 3. Nested Brains

Compose complex workflows from smaller brains:

```typescript
const subBrain = brain('Sub Process').step('Transform', ({ state }) => ({
  result: state.input * 2,
}));

const mainBrain = brain('Main Process')
  .step('Prepare', () => ({ value: 10 }))
  .brain('Run Sub Process', subBrain, {
    initialState: ({ state }) => ({ input: state.value }),
  });
```

The inner brain's final state is spread directly onto the outer state (e.g., `state.result` will be `20`). `initialState` is optional (defaults to `{}`) and can be a static object or a function receiving `{ state, options, ...plugins }`. To namespace, design the inner brain to return its results under a single key.

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
  .page('Review emails', (ctx) => ({ ..., formSchema: ... }))
  // form data auto-merges onto state
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
- `pages` - Pages service for HTML page management
- `env` - Runtime environment containing `origin` (base URL) and `secrets` (typed secrets object)
- Custom plugin-provided values (if configured with `.withPlugin()` or `createBrain()`)

> **Note**: `response` is only available inside `.handle()` callbacks after `.wait()`. For `.page()` with `formSchema`, the response is spread directly onto state. See [Page Steps](#page-steps) and [Webhooks](#webhooks) for details.

## Configuration Methods

### Brain Options

Options provide runtime configuration for your brains, allowing different behavior without changing code. They're perfect for settings like API endpoints, feature flags, output preferences, or channel identifiers.

#### Typing Options

To use options in your brain, define a Zod schema with `withOptions`:

```typescript
import { z } from 'zod';

// Define your options schema
const notificationSchema = z.object({
  slackChannel: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  includeTimestamp: z.boolean().default(true)
});

// Use withOptions to add runtime validation
const notificationBrain = brain('Notification Brain')
  .withOptions(notificationSchema)
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

#### Options vs Plugins vs Initial State

Understanding when to use each:

- **Options**: Runtime configuration (channels, endpoints, feature flags)
  - Override from CLI with `-o key=value`
  - Don't change during execution
  - Examples: `slackChannel`, `apiEndpoint`, `debugMode`

- **Plugins**: External dependencies and side effects (clients, loggers, databases)
  - Configure once with `.withPlugin()` or `createBrain()`
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
  .withOptions(notificationSchema)
  .withPlugin(slack)
  .withPlugin(email)
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

### Plugin Injection

The `withPlugin` method provides dependency injection for your brains, making plugin-provided values available throughout the workflow while maintaining testability.

#### Basic Usage

```typescript
const brainWithPlugins = brain('Plugin Brain')
  .withPlugin(logger)
  .withPlugin(database)
  .step('Log and Save', async ({ state, logger, database }) => {
    logger.info('Processing state');
    await database.save(state);
    return state;
  });
```

#### Where Plugin Values Are Available

Plugin-provided values are destructured alongside other parameters in:

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
  message: ({ state }) => 'Generate something',
  outputSchema: schema,
}, async ({ state, response, logger, database }) => {
  logger.info('Saving AI response');
  await database.save({ ...state, ...response });
  return state;
})
```

3. **Nested Brain Config**:
```typescript
.brain('Run Sub-Brain', subBrain)
```

#### Real-World Example

```typescript
// Create a brain with multiple plugins
const analysisBrain = brain('Data Analysis')
  .withPlugin(api)
  .withPlugin(cache)
  .withPlugin(metrics)
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
    message: ({ state: { data } }) => `Analyze this data: <%= '${JSON.stringify(data)}' %>`,
    outputSchema: z.object({
      insights: z.array(z.string()),
      confidence: z.number()
    }),
  })
  .step('Save Results', async ({ state, api, cache, metrics }) => {
    const { insights, confidence } = state;

    // Save to cache for next time
    await cache.set('analysis_result', { insights, confidence });

    // Submit to API
    await api.submitResult({ insights, confidence });

    // Track completion
    state.endTimer(); // End the timer
    metrics.track('analysis_complete', {
      insights_count: insights.length,
      confidence,
      from_cache: state.fromCache
    });

    return state;
  });
```

#### Testing with Plugins

Plugins make testing easier by allowing you to inject mocks:

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
  .withPlugin(mockLoggerPlugin)
  .withPlugin(mockDatabasePlugin)
  .step('Do Something', async ({ logger, database }) => {
    logger.info('Fetching data');
    const data = await database.find('123');
    return { data };
  });

// Run test
const result = await runBrainTest(testBrain, {
  client: createMockClient()
});

// Verify plugin calls
expect(mockLogger.info).toHaveBeenCalledWith('Fetching data');
expect(mockDatabase.find).toHaveBeenCalledWith('123');
expect(result.finalState.data).toEqual({ id: '123', name: 'Test' });
```

#### Important Notes

- Call `withPlugin` before defining any steps
- Plugin-provided values are typed - TypeScript knows exactly which values are available
- Plugin values are not serialized - they're for side effects and external interactions
- Each brain instance maintains its own plugin references

### Tool-Calling Prompt Loops

Use `.prompt()` with a `loop` property to run an LLM with tools. The LLM calls tools iteratively until it calls the auto-generated `done` tool:

```typescript
import { z } from 'zod';
import { generatePage, waitForWebhook } from '@positronic/core';

brain('Tool Brain')
  .prompt('Fetch and Save', () => ({
    system: 'You can fetch and save data.',
    message: 'Fetch user data and save the summary.',
    outputSchema: z.object({ summary: z.string() }),
    loop: {
      tools: {
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
            return { success: true, id: 'generated-id' };
          }
        }
      },
    },
  }));
```

Tools are explicit on each `.prompt()` — there's no global tool registration.

### Component Configuration with `withComponents()`

The `withComponents()` method registers custom UI components for use in `.page()` steps:

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
  .page('Dashboard', ({ state }) => ({
    prompt: `
      Create a dashboard using CustomCard components to display:
      - User name: <%= '${state.userName}' %>
      - Account status: <%= '${state.status}' %>
      Use DataTable to show recent activity.
    `,
    formSchema: z.object({
      acknowledged: z.boolean()
    }),
  }));
```

### Typed Store with `withStore()`

The `withStore()` method declares a typed key-value store for persistent structured data. Unlike brain state (which resets each run), store data persists across runs.

#### Declaring Store Shape

Use Zod types to declare the shape of your store. All store keys are scoped per-brain — each brain gets its own namespace automatically.

```typescript
import { z } from 'zod';

const myBrain = brain('email-preferences')
  .withStore({
    deselectedThreads: z.array(z.string()),
    lastProcessedAt: z.number(),
  })
  .step('Process', async ({ store }) => {
    // Typed get — returns the value or undefined if not set
    const deselected = await store.get('deselectedThreads') ?? [];
    const lastTime = await store.get('lastProcessedAt');

    // Typed set
    await store.set('lastProcessedAt', Date.now());

    return { deselected, lastTime };
  });
```

#### Per-User Fields

Mark fields as per-user to scope them to the current user. This is useful for user preferences, user-specific state, or any data that should be isolated between users.

```typescript
const myBrain = brain('dashboard')
  .withStore({
    globalConfig: z.object({ theme: z.string() }),           // shared across all users
    userPreferences: { type: z.object({ darkMode: z.boolean() }), perUser: true },  // per-user
  })
  .step('Load Preferences', async ({ store }) => {
    const config = await store.get('globalConfig');
    const prefs = await store.get('userPreferences');  // scoped to currentUser automatically
    return { config, prefs };
  });
```

Per-user fields require a `currentUser` to be set when running the brain. If a per-user field is accessed without a current user, an error is thrown.

#### Store Scoping

All store keys are automatically namespaced:

- **Shared fields**: scoped per-brain (e.g., brain "my-brain" key "counter" is isolated from brain "other-brain" key "counter")
- **Per-user fields**: scoped per-brain AND per-user (each user gets their own value)

There is no global scope — every field belongs to a specific brain.

#### Store Operations

The store provides four operations:

```typescript
await store.get('key');     // Returns T | undefined
await store.set('key', value);  // Sets the value
await store.delete('key');  // Removes the key
await store.has('key');     // Returns boolean
```

#### Using with `createBrain()`

You can declare store fields at the project level so all brains share the same store shape:

```typescript
// src/brain.ts
export const brain = createBrain({
  plugins: [slack],
  store: {
    processedCount: z.number(),
    userSettings: { type: z.object({ notifications: z.boolean() }), perUser: true },
  },
});
```

Or declare per-brain stores for brain-specific data:

```typescript
// src/brains/my-brain.ts
export default brain('my-brain')
  .withStore({ counter: z.number() })
  .step('Increment', async ({ store }) => {
    const count = await store.get('counter') ?? 0;
    await store.set('counter', count + 1);
    return { count: count + 1 };
  });
```

### Using `createBrain()` for Project Configuration

For project-wide configuration, use `createBrain()` in your `src/brain.ts` file:

```typescript
// src/brain.ts
import { createBrain } from '@positronic/core';
import { z } from 'zod';

export const brain = createBrain({
  plugins: [logger, api],
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
  },
  store: {
    processedCount: z.number(),
  }
});
```

All brains created with this factory will have access to the configured plugins, tools, components, and store.

#### Typing Initial State and Options

By default, the first `.step()` establishes the state type and inference flows from there. But when a brain receives its initial state from outside — via `initialState` in `.run()`, from the CLI, or from a parent brain — the first step's `state` parameter is untyped.

You can provide type parameters to `brain()` to type the initial state and options:

```typescript
// brain<TOptions, TState>(title)
// Both parameters are optional and default to {} and object respectively.

// Type just the initial state (pass {} for options)
const myBrain = brain<{}, { userId: string; email: string }>('process-user')
  .step('Greet', ({ state }) => {
    // state.userId and state.email are correctly typed
    return { ...state, greeting: 'Hello ' + state.email };
  });

// Type both options and initial state
const myBrain = brain<{ verbose: boolean }, { count: number }>('counter')
  .step('Process', ({ state, options }) => {
    if (options.verbose) console.log('Count:', state.count);
    return { ...state, doubled: state.count * 2 };
  });
```

This is useful in several situations:

- **Brains run with `initialState`**: When calling `.run({ initialState: { ... } })` or passing initial state from the CLI
- **Sub-brains**: When a parent brain provides initial state via `.brain()` or iterate's `initialState` option
- **Any brain where the first step receives rather than creates state**

Existing `brain('title')` calls without type parameters continue to work unchanged.

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

Resources are files in your project's `/resources` directory that brains can access at runtime. They provide a type-safe way to load text and binary content.

### Adding Resources

Place files in the `/resources` directory:

```
resources/
├── config.json
├── prompts/
│   ├── customerSupport.md
│   └── codeReview.md
└── data/
    └── records.csv
```

### Accessing Resources

Access resources using dot notation that matches the file structure:

```typescript
brain('Resource Example').step('Load Data', async ({ resources }) => {
  const config = await resources.config.load();
  const template = await resources.prompts.customerSupport.load();
  return { config: JSON.parse(config), template };
});
```

Resources are also available in prompt templates:

```typescript
brain('Template Example').prompt('Generate Content', {
  message: async ({ state, resources }) => {
    const template = await resources.prompts.customerSupport.load();
    return template.replace('{{issue}}', state.issue);
  },
  outputSchema: z.object({ response: z.string() }),
});
```

### Resource Methods

Each resource has a single `load()` method that returns the appropriate type:

- `TextResource.load()` - Returns `Promise<string>` (for text files like `.md`, `.json`, `.txt`)
- `BinaryResource.load()` - Returns `Promise<Buffer>` (for binary files like images)

The resource type is determined automatically based on file content detection when you run `px resources types`.

### File Naming and Property Access

The resource name you use in code must be a valid JavaScript identifier. The system strips file extensions automatically, so `config.json` is accessed as `resources.config`.

**Important**: Resource filenames must be valid JS identifiers (after extension stripping) to be accessible via dot notation. This means:

```
resources/
├── myPrompt.md          ✅  → resources.myPrompt.load()
├── config.json          ✅  → resources.config.load()
├── reference-material.md  ❌  → "reference-material" has a hyphen, not a valid identifier
├── referenceMaterial.md   ✅  → resources.referenceMaterial.load()
```

Use camelCase or single-word names for your resource files. Avoid hyphens, spaces, or other characters that aren't valid in JavaScript identifiers.

You can also access resources by their full filename (including extension) using bracket notation:

```typescript
const content = await resources['config.json'].load();
```

### Type Generation

Run `px resources types` to generate a `resources.d.ts` file in your project root. This provides TypeScript type safety for your resources — your editor will autocomplete resource names and flag typos.

The generated types distinguish between `TextResource` and `BinaryResource` based on file content detection, so `load()` returns the correct type (`string` or `Buffer`).

### Path-Based Access

You can also load resources by path string at any level of the resource tree:

```typescript
const content = await resources.loadText('prompts/customerSupport.md');
const binary = await resources.loadBinary('images/logo.png');
```

## Organizing Complex Prompts

When prompts become more than a sentence or two, extract them into separate files for better maintainability:

### File Structure

For complex brains, organize your code into folders:

```
src/brains/
├── hn-bot/
│   ├── brain.ts           # Main brain definition
│   └── ai-filter-prompt.ts # Complex prompt configuration
└── simple-bot.ts          # Simple brains can stay as single files
```

### Extracting Prompts

When you extract a prompt to a separate file, you'll need to explicitly specify the state type:

```typescript
// src/brains/hn-bot/ai-filter-prompt.ts
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
  message: async ({ state, resources }: { state: FilterPromptState, resources: Resources }) => {
    // Load a prompt template from resources
    const template = await resources.prompts.hnFilter.load();

    // Build the prompt with state data
    const articleList = state.articles
      .map((a, i) => `<%= '${i + 1}' %>. <%= '${a.title}' %> (score: <%= '${a.score}' %>)`)
      .join('\n');

    return template
      .replace('{{articleList}}', articleList)
      .replace('{{preferences}}', state.userPreferences || 'No specific preferences');
  },
  outputSchema: z.object({
    selectedArticles: z.array(z.number()).describe('Indices of selected articles'),
    reasoning: z.string().describe('Brief explanation of selections'),
  }),
};

// src/brains/hn-bot/brain.ts
import { brain } from '../../brain.js';
import { aiFilterPrompt } from './ai-filter-prompt.js';

export default brain('HN Article Filter')
  .step('Fetch Articles', async ({ state }) => {
    // Fetch Hacker News articles
    const articles = await fetchHNArticles();
    return { articles };
  })
  .prompt('Filter Articles', aiFilterPrompt)
  .step('Format Results', ({ state }) => ({
    selectedArticles: state.selectedArticles.map(
      i => state.articles[i]
    ),
    reasoning: state.reasoning,
  }));
```

### When to Extract Prompts

Extract prompts to separate files when:
- The message is more than 2-3 lines
- The prompt uses complex logic or formatting
- You need to load resources
- The prompt might be reused in other brains
- You want to test the prompt logic separately

## JSX Templates

Templates can be written as JSX instead of template literal strings. This improves readability for complex prompts with conditionals, loops, and multi-line content. Prettier formats JSX automatically, keeping your prompts properly indented within the builder chain.

### Basic Usage

Rename your brain file from `.ts` to `.tsx` and return JSX from the message function:

```tsx
// src/brains/analyze.tsx
import { brain } from '../brain.js';
import { z } from 'zod';

export default brain('analyze')
  .prompt('Analyze', {
    message: ({ state: { topic, context } }) => (
      <>
        Analyze the following topic: {topic}

        Context: {context}

        Please provide:
        - A summary
        - Key insights
        - Recommendations
      </>
    ),
    outputSchema: z.object({
      summary: z.string(),
      insights: z.array(z.string()),
      recommendations: z.array(z.string()),
    }),
  });
```

No `render()` call is needed — the runner handles JSX rendering internally. Old string messages still work, so this is fully opt-in.

### Conditionals

Use `&&` for boolean conditions and ternaries when you need both branches or when the condition could be a falsy non-boolean (like `0` or `""`):

```tsx
// && works when the condition is strictly boolean
message: ({ state: { user, isVIP } }) => (
  <>
    Create a greeting for {user.name}.
    {isVIP && <>This is a VIP customer. Use premium language.</>}
  </>
)

// Ternary for either/or content
message: ({ state: { user, tier } }) => (
  <>
    Create a greeting for {user.name}.
    {tier === 'premium'
      ? <>Use premium, personalized language.</>
      : <>Use friendly, standard language.</>
    }
  </>
)
```

**Watch out for non-boolean falsy values.** `{count && <>...</>}` renders `"0"` when count is 0 — use `{count > 0 && <>...</>}` or a ternary instead.

### Loops

Use `.map()` naturally inside JSX:

```tsx
message: ({ state: { items } }) => (
  <>
    Review the following items:
    {items.map(item => (
      <>
        - {item.name}: {item.description}
      </>
    ))}
  </>
)
```

### Reusable Prompt Components

Extract common prompt sections into function components:

```tsx
const CategoryInstructions = ({ categories }: { categories: string[] }) => (
  <>
    Valid categories: {categories.join(', ')}
    Always pick exactly one. If unsure, pick "other".
  </>
);

// Use in a message
message: ({ state: { email, categories } }) => (
  <>
    Categorize this email:
    From: {email.from}
    Subject: {email.subject}

    <CategoryInstructions categories={categories} />
  </>
)
```

### Async Components

Function components can be async, which is useful for loading resources:

```tsx
const Resource = async ({ from }: { from: any }) => {
  const content = await from.loadText();
  return <>{content}</>;
};

message: ({ state, resources }) => (
  <>
    Summarize this document using the guidelines below:

    <Resource from={resources.guidelines} />

    Document:
    {state.document}
  </>
)
```

## Iterating Over Items

When you need to run the same operation over multiple items, use `.map()`. You can iterate a prompt directly, or iterate a brain for more complex per-item logic.

### Basic `.map()` with a Brain

Run a nested brain once per item:

```typescript
const processBrain = brain('Process Item')
  .step('Transform', ({ state }) => ({
    ...state,
    result: state.value * 2,
  }));

brain('Process All Items')
  .step('Initialize', () => ({
    items: [{ value: 1 }, { value: 2 }, { value: 3 }]
  }))
  .map('Process Each', 'results', {
    run: processBrain,
    over: ({ state }) => state.items,
    initialState: (item) => ({ value: item.value, result: 0 }),
    error: (item, error) => ({ value: item.value, result: 0 }),
  })
  .step('Use Results', ({ state }) => ({
    ...state,
    // results is an IterateResult — use .values to get just the results
    totals: state.results.values.map(result => result.result),
  }));
```

### Iterating a Prompt

Use `.map()` with `prompt: { message, outputSchema }` to run a prompt per item:

```typescript
brain('Item Processor')
  .step('Initialize', () => ({
    items: [
      { id: 1, title: 'First item' },
      { id: 2, title: 'Second item' },
      { id: 3, title: 'Third item' },
    ]
  }))
  .map('Summarize Items', 'summaries', {
    prompt: {
      message: ({ item }) => `Summarize this item: <%= '${item.title}' %>`,
      outputSchema: z.object({ summary: z.string() }),
    },
    over: ({ state }) => state.items,
    error: () => ({ summary: 'Failed to summarize' }),
  })
  .step('Process Results', ({ state }) => ({
    ...state,
    processedSummaries: state.summaries.map((item, result) => ({
      id: item.id,
      summary: result.summary,
    })),
  }));
```

The `message` function receives `{ item, state, options, resources }` where `item` is the current iteration item. The result per item is `z.infer` of the `outputSchema`. You can also pass `client` to use a different LLM client for the prompt.

### Iterating an Agent

To iterate an agent over items, wrap it in a brain and use `.map()`:

```typescript
const researchBrain = brain('Research Single')
  .brain('Research', ({ state, tools }) => ({
    system: 'You are a research assistant.',
    prompt: `Research this topic: <%= '${state.name}' %>`,
    tools: { search: tools.search },
    outputSchema: z.object({ summary: z.string() }),
  }));

brain('Research Topics')
  .step('Initialize', () => ({
    topics: [{ name: 'AI' }, { name: 'Robotics' }]
  }))
  .map('Research Each', 'results', {
    run: researchBrain,
    over: ({ state }) => state.topics,
    initialState: (topic) => ({ name: topic.name }),
  })
  .step('Use Results', ({ state }) => ({
    ...state,
    summaries: state.results.values.map(result => result.summary),
  }));
```

### `.map()` Options

`.map()` has two modes: **brain mode** (run an inner brain per item) and **prompt mode** (run a prompt per item).

Note: The `stateKey` is now the 2nd argument to `.map()`: `.map('title', 'stateKey', { ... })`.

**Common options** (both modes):

- `over: (context) => T[] | Promise<T[]>` - Function returning the array to iterate over. Receives the full step context (`{ state, options, client, resources, ... }`) — the same context object that step actions receive. Most commonly you'll destructure just `{ state }`, but you can access options, plugin-provided values, or any other context field. Can be async.
- `error: (item, error) => Result | null` - Optional fallback when an item fails. Return `null` to skip the item entirely.

**Brain mode** (use `run`):

- `run: Brain` - The inner brain to execute for each item
- `initialState: (item, outerState) => State` - Function to create the inner brain's initial state from each item

**Prompt mode** (use `prompt: { message, outputSchema }`):

- `prompt.message: (context) => string` - Message function. Receives `{ item, state, options, resources }` where `item` is the current iteration item.
- `prompt.outputSchema: ZodSchema` - Zod schema for the LLM output.
- `client?: ObjectGenerator` - Optional per-step LLM client override.

#### Accessing options and plugins in `over`

Since `over` receives the full step context, you can use options or plugin-provided values to determine which items to iterate over:

```typescript
const processItemBrain = brain('Process Single')
  .step('Process', ({ state }) => ({
    ...state,
    result: `Processed item <%= '${state.id}' %>`,
  }));

brain('Dynamic Processor')
  .withOptions(z.object({ category: z.string() }))
  .step('Load items', () => ({
    items: [
      { id: 1, category: 'a' },
      { id: 2, category: 'b' },
      { id: 3, category: 'a' },
    ]
  }))
  .map('Process', 'results', {
    run: processItemBrain,
    over: ({ state, options }) => state.items.filter(i => i.category === options.category),
    initialState: (item) => ({ id: item.id, result: '' }),
  })
```

### Result Format

By default, results are stored as an `IterateResult` — a collection that wraps `[item, result]` pairs and provides a richer API than raw tuples:

- **`.items`** — array of all input items
- **`.values`** — array of all results
- **`.entries`** — array of `[item, result]` tuples
- **`.length`** — number of results
- **`.filter((item, result) => boolean)`** — returns a new `IterateResult` with only matching pairs
- **`.map((item, result) => value)`** — maps over both item and result, returns a plain array
- **`for...of`** — iterates as `[item, result]` tuples (backward compatible with destructuring)

The key always comes from `stateKey`.

## Prompt Steps with Tool-Calling Loops

For complex AI workflows that require tool use, use `.prompt()` with a `loop` property. The LLM calls tools iteratively until it calls the auto-generated `done` tool with data matching the `outputSchema`:

```typescript
brain('Research Assistant')
  .step('Initialize', () => ({
    query: 'What are the latest developments in AI?'
  }))
  .prompt('Research', ({ state }) => ({
    system: 'You are a helpful research assistant with access to search tools.',
    message: `Research this topic: <%= '${state.query}' %>`,
    outputSchema: z.object({
      findings: z.array(z.string()),
      summary: z.string(),
    }),
    loop: {
      tools: {
        search: {
          description: 'Search the web for information',
          inputSchema: z.object({
            query: z.string().describe('The search query')
          }),
          execute: async ({ query }) => {
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
    },
  }))
  .step('Format Results', ({ state }) => ({
    ...state,
    researchResults: state.summary,
  }));
```

### Prompt Config (with loop)

- `message: string | TemplateReturn` - The user prompt sent to the LLM
- `system?: string | TemplateReturn` - System prompt (optional, works with or without loop)
- `outputSchema: ZodSchema` - **Required.** Structured output schema. With `loop`, generates a terminal `done` tool. Without `loop`, used for single-shot structured output.
- `loop.tools: Record<string, Tool>` - Tools available to the LLM
- `loop.maxTokens?: number` - Maximum cumulative tokens across all iterations
- `loop.maxIterations?: number` - Maximum loop iterations (default: 100)
- `loop.toolChoice?: 'auto' | 'required' | 'none'` - Tool choice strategy (default: `'required'`)

Without `loop`, `.prompt()` makes a single `generateObject()` call — no tools, no iteration.

### Tool Definition

Each tool requires:
- `description: string` - What the tool does
- `inputSchema: ZodSchema` - Zod schema for the tool's input
- `execute?: (input, context) => Promise<any>` - Function to execute when the tool is called
- `terminal?: boolean` - If true, calling this tool ends the loop

### Tool Webhooks (waitFor)

Tools can pause execution and wait for external events by returning `{ waitFor: webhook(...) }` from their `execute` function:

```typescript
import approvalWebhook from '../webhooks/approval.js';

brain('Support Ticket Handler')
  .prompt('Handle Request', ({ state }) => ({
    system: 'You are a support agent. Escalate complex issues for human review.',
    message: `Handle this support ticket: <%= '${state.ticket.description}' %>`,
    outputSchema: z.object({
      resolution: z.string().describe('How the ticket was resolved'),
    }),
    loop: {
      tools: {
        escalateToHuman: {
          description: 'Escalate the ticket to a human reviewer for approval',
          inputSchema: z.object({
            summary: z.string().describe('Summary of the issue'),
            recommendation: z.string().describe('Your recommended action'),
          }),
          execute: async ({ summary, recommendation }, context) => {
            await notifyReviewer({ summary, recommendation, ticketId: context.state.ticketId });
            return { waitFor: approvalWebhook(context.state.ticketId) };
          },
        },
      },
    },
  }))
  .step('Process Result', ({ state }) => ({
    ...state,
    handled: true,
  }));
```

Key points about tool `waitFor`:
- Return `{ waitFor: webhook(...) }` to pause and wait for an external event
- The webhook response is fed back as a tool result — the loop continues with this data
- You can wait for multiple webhooks (first response wins): `{ waitFor: [webhook1(...), webhook2(...)] }`
- The `execute` function receives a `context` parameter with access to `state`, `options`, `env`, etc.

### Output Schema

The `outputSchema` generates a terminal `done` tool that the LLM must call to complete. The result is spread directly onto state:

```typescript
brain('Entity Extractor')
  .prompt('Extract Entities', () => ({
    system: 'You are an entity extraction assistant.',
    message: 'Extract all people and organizations from the provided text.',
    outputSchema: z.object({
      people: z.array(z.string()).describe('Names of people mentioned'),
      organizations: z.array(z.string()).describe('Organization names'),
      confidence: z.number().min(0).max(1).describe('Confidence score'),
    }),
    loop: { tools: {} },
  }))
  .step('Use Extracted Data', ({ state }) => {
    // TypeScript knows state has people, organizations, and confidence
    return {
      ...state,
      summary: 'Extracted ' + state.people.length + ' people and ' +
               state.organizations.length + ' organizations',
    };
  });
```

Key points:
- The `done` tool is auto-generated from your `outputSchema`
- If the LLM provides invalid output, the error is fed back so it can retry
- The result is spread directly onto state (e.g., `state.people`, `state.organizations`)
- Full TypeScript type inference flows to subsequent steps

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

When building custom HTML pages with forms, you must include a CSRF token to prevent unauthorized submissions. The `.page()` step handles this automatically, but custom pages require manual setup. This applies whether you submit to the built-in `page-form` endpoint or to a custom webhook.

The token is always passed as a **query parameter** on the form's action URL (`?token=xyz`), not as a hidden form field.

#### Using a Custom Webhook

If your page submits to a custom webhook (e.g., `/webhooks/archive`), include the token in the action URL and pass it as the second argument when creating the webhook registration:

```typescript
import { generateFormToken } from '@positronic/core';
import archiveWebhook from '../webhooks/archive.js';

brain('Archive Workflow')
  .step('Create Page', async ({ state, pages, env }) => {
    const formToken = generateFormToken();

    const html = `<html>
      <body>
        <form method="POST" action="<%= '${env.origin}' %>/webhooks/archive?token=<%= '${formToken}' %>">
          <input type="text" name="name" placeholder="Your name">
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>`;

    await pages.create('my-page', html);
    return { ...state, formToken };
  })
  .wait('Wait for submission', ({ state }) => archiveWebhook(state.sessionId, state.formToken), { timeout: '24h' })
  .handle('Process', ({ state, response }) => ({
    ...state,
    name: response.name,
  }));
```

#### Using the System `page-form` Endpoint

If your page submits to the built-in `page-form` endpoint, include the token in the action URL and in the webhook registration object:

```typescript
import { generateFormToken } from '@positronic/core';

brain('Custom Form')
  .step('Create Form Page', async ({ state, pages, env }) => {
    const formToken = generateFormToken();
    const webhookIdentifier = `custom-form-<%= '${Date.now()}' %>`;
    const formAction = `<%= '${env.origin}' %>/webhooks/system/page-form?identifier=<%= '${encodeURIComponent(webhookIdentifier)}' %>&token=<%= '${formToken}' %>`;

    const page = await pages.create('my-form', `<html>
      <body>
        <form method="POST" action="<%= '${formAction}' %>">
          <input type="text" name="name" placeholder="Your name">
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>`);

    return {
      ...state,
      pageUrl: page.url,
      webhook: { slug: 'page-form', identifier: webhookIdentifier, token: formToken },
    };
  })
  .wait('Wait for form', ({ state }) => state.webhook)
  .handle('Process', ({ state, response }) => ({
    ...state,
    name: response.name,
  }));
```

#### Summary

The three required pieces for any custom page with a form:
1. Call `generateFormToken()` to get a token
2. Include the token as a **query parameter** on the form's action URL (e.g., `action="<%= '${webhookUrl}' %>?token=<%= '${formToken}' %>"`)
3. Include the `token` in your webhook registration — either as the second argument to a custom webhook function (e.g., `myWebhook(identifier, token)`) or in the registration object for `page-form`

Without a token, the server will reject the form submission.

## Page Steps

Page steps allow brains to generate dynamic user interfaces using AI. When `formSchema` is provided, `.page()` generates a page, auto-suspends the brain, and spreads the form response directly onto state. Use the optional `onCreated` callback for side effects (Slack messages, emails) that need access to the generated page URL.

### Basic Page Step

```typescript
import { z } from 'zod';

brain('Feedback Collector')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John Doe',
  }))
  // Generate the form, onCreated users, auto-suspend, auto-merge response
  .page('Collect Feedback', ({ state, slack }) => ({
    prompt: `
      Create a feedback form for <%= '${state.userName}' %>.
      Include fields for rating (1-5) and comments.
    `,
    formSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
    onCreated: async (page) => {
      await slack.post('#feedback', `Please fill out: <%= '${page.url}' %>`);
    },
  }))
  // No .handle() needed — form data spreads onto state
  .step('Process Feedback', ({ state }) => ({
    ...state,
    feedbackReceived: true,
    // state.rating and state.comments are typed
  }));
```

### How Page Steps Work

1. **Prompt**: The `prompt` value describes the desired UI
2. **AI Generation**: The AI creates a component tree based on the prompt
3. **onCreated**: The optional `onCreated` callback runs with a `page` object containing `url` and `webhook`. Use it to notify users (Slack, email, etc.)
4. **Auto-Suspend**: The brain automatically suspends and waits for the form submission
5. **Auto-Spread**: The form data is automatically spread onto state (`{ ...state, ...formData }`)

### The `page` Object

The `page` object is available inside the `onCreated` callback:
- `page.url` - URL where users can access the form
- `page.webhook` - Pre-configured webhook for form submissions

### Prompt Best Practices

Be specific about layout and content:

```typescript
.page('Contact Form', ({ state }) => ({
  prompt: `
    Create a contact form with:
    - Header: "Get in Touch"
    - Name field (required)
    - Email field (required, pre-filled with "<%= '${state.email}' %>")
    - Message textarea (required)
    - Submit button labeled "Send Message"

    Use a clean, centered single-column layout.
  `,
  formSchema: z.object({
    name: z.string(),
    email: z.string().email(),
    message: z.string(),
  }),
}))
```

### Data Bindings

Use `{{path}}` syntax to bind props to runtime data:

```typescript
.page('Order Summary', ({ state }) => ({
  prompt: `
    Create an order summary showing:
    - List of items from {{cart.items}}
    - Total: {{cart.total}}
    - Shipping address input
    - Confirm button
  `,
  formSchema: z.object({
    shippingAddress: z.string(),
  }),
}))
```

### Multi-Step Forms

Chain page steps for multi-page workflows:

```typescript
brain('User Onboarding')
  .step('Start', () => ({ userData: {} }))

  // Step 1: Personal info
  .page('Personal Info', ({ notify }) => ({
    prompt: `
      Create a form for personal information:
      - First name, Last name
      - Date of birth
      - Next button
    `,
    formSchema: z.object({
      firstName: z.string(),
      lastName: z.string(),
      dob: z.string(),
    }),
    onCreated: async (page) => {
      await notify(`Step 1: <%= '${page.url}' %>`);
    },
  }))
  // No .handle() needed — form data spreads onto state

  // Step 2: Preferences
  .page('Preferences', ({ state, notify }) => ({
    prompt: `
      Create preferences form for <%= '${state.firstName}' %>:
      - Newsletter subscription checkbox
      - Contact preference (email/phone/sms)
      - Complete button
    `,
    formSchema: z.object({
      newsletter: z.boolean(),
      contactMethod: z.enum(['email', 'phone', 'sms']),
    }),
    onCreated: async (page) => {
      await notify(`Step 2: <%= '${page.url}' %>`);
    },
  }))
  // No .handle() needed — form data spreads onto state
  .step('Complete', ({ state }) => ({
    ...state,
    onboardingComplete: true,
  }));
```

For more details on page steps, see the full Page Step Guide in the main Positronic documentation.

## Complete Example

```typescript
import { brain } from '../brain.js';
import { BrainRunner } from '@positronic/core';
import { z } from 'zod';

// Create brain with all features
const completeBrain = brain({
  title: 'Complete Example',
  description: 'Demonstrates all Brain DSL features',
})
  .withPlugin(logger)
  .withPlugin(analytics)
  .step('Initialize', ({ logger, analytics }) => {
    logger.log('Starting workflow');
    analytics.track('brain_started');
    return { startTime: Date.now() };
  })
  .prompt('Generate Plan', {
    message: async ({ state, resources }) => {
      // Load a template from resources
      const template = await resources.templates.projectPlan.load();
      return template.replace('{{context}}', 'software project');
    },
    outputSchema: z.object({
      tasks: z.array(z.string()),
      duration: z.number(),
    }),
  })
  .step('Process Plan', ({ state, logger, analytics }) => {
    logger.log(`Plan generated with <%= '${state.tasks.length}' %> tasks`);
    analytics.track('plan_processed', {
      task_count: state.tasks.length,
      duration: state.duration
    });
    return {
      ...state,
      taskCount: state.tasks.length,
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

## Files Service

The `files` service is available on the step context for creating, reading, and managing files.

### Basic Usage

```typescript
.step("Save report", async ({ files }) => {
  const file = files.open('report.txt');
  await file.write('Report content');
  const url = file.url; // public download URL
  return { reportFile: file.name }; // store name in state, not URL
})
```

### Streaming Writes

```typescript
// Stream from a URL — never buffered
await file.write(await fetch('https://example.com/large.mp3'));

// Copy between files
await file.write(files.open('source.txt'));
```

### Zip Builder

```typescript
.step("Bundle", async ({ state, files }) => {
  const zip = files.zip('results.zip');
  await zip.write('data.txt', 'content');
  await zip.write('audio.mp3', await fetch(state.mp3Url));
  const ref = await zip.finalize();
  return { downloadUrl: files.open(ref.name).url };
})
```

### Scoping

```typescript
files.open('data.txt');                          // 'brain' (default) — persists across runs
files.open('temp.txt', { scope: 'run' });        // cleaned up after run
files.open('profile.json', { scope: 'global' }); // persists across brains
```

### JSX Components

```tsx
import { File, Resource } from '@positronic/core';

.prompt("Analyze", ({ state }) => ({
  prompt: (
    <>
      <Resource name="guidelines" />
      <File name={state.transcriptFile} />
    </>
  ),
  outputSchema: z.object({ summary: z.string() }),
}))
```

### Attachments

```typescript
.prompt("Analyze PDF", async ({ files }) => ({
  prompt: "Analyze the attached document.",
  attachments: [files.open('report.pdf')],
  outputSchema: z.object({ summary: z.string() }),
}))
```

### Agent Tools

```typescript
import { readFile, writeFile } from '@positronic/core';

.brain("Analyze", () => ({
  prompt: "Review the files and write a summary.",
  tools: { readFile, writeFile },
}))
```
