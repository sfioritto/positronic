# Tips for AI Agents

This document contains helpful tips and patterns for AI agents working with Positronic projects.

## TypeScript Compilation

Run `npm run typecheck` frequently as you make changes to ensure your TypeScript code compiles correctly. This will catch type errors early and help maintain code quality.

## Running the Development Server

When you need to run a development server, use the `--log-file` option to capture server output. **Important**: Always place the server log file in the `/tmp` directory so it gets cleaned up automatically by the operating system.

### 1. Start the server with logging

**Default mode (recommended for most cases):**
```bash
px server -d
```

This starts the server on the default port (3000) with logs written to `.positronic-server.log`.

**Custom port mode (when you need a specific port):**

First, generate a random port between 30000 and 50000:
```bash
echo $((30000 + RANDOM % 20000))
```

**Remember this port number** and use it for all subsequent commands. For example, if the port is 38291:

```bash
px server --port 38291 --log-file /tmp/server-38291.log -d
```

Note: When using `--port` with `-d`, you MUST also specify `--log-file`.

The `-d` flag runs the server in detached/background mode. The server will output its process ID (PID) which you can use to stop it later.

### 2. Run commands using your server

**If using default port (3000):**
```bash
# No need to set POSITRONIC_PORT
px brain list
px brain run my-brain
```

**If using custom port:**
```bash
# Set the port environment variable for subsequent commands (using your remembered port)
export POSITRONIC_PORT=38291

# Now all px commands will use your server
px brain list
px brain run my-brain
```

### 3. Check server logs when needed

**Default server:**
```bash
# View the entire log file
cat .positronic-server.log

# View the last 50 lines of the log file
tail -n 50 .positronic-server.log
```

**Custom port server:**
```bash
# View the entire log file (using your remembered port)
cat /tmp/server-38291.log

# View the last 50 lines of the log file
tail -n 50 /tmp/server-38291.log
```

### 4. Stop the server when done

**Using the built-in kill option (recommended for default server):**
```bash
# Kill default server
px server -k
```

**Manual methods:**
```bash
# Default server
kill $(cat .positronic-server.pid)

# Custom port server (PID file includes port number)
kill $(cat .positronic-server-38291.pid)

# Or find and kill the server process by port
kill $(lsof -ti:38291)
```

### Important Notes
- The `-d` flag runs the server in detached/background mode (similar to Docker's -d)
- Default server: PID stored in `.positronic-server.pid`, logs in `.positronic-server.log`
- Custom port servers: PID stored in `.positronic-server-{port}.pid`
- When using `--port` with `-d`, you MUST also specify `--log-file`
- Log files are always appended to (never overwritten)
- The server will error if another server is already running on the same port
- Always clean up by killing the server process when done
- The log file contains timestamped entries with [INFO], [ERROR], and [WARN] prefixes

## Guard Clauses

Use `.guard()` to short-circuit a brain when a condition isn't met:

```typescript
brain('approval-example')
  .step('Init', () => ({ needsApproval: true, data: [] }))
  .guard(({ state }) => state.data.length > 0, 'Has data')
  // everything below only runs if guard passes
  .step('Process', ({ state }) => ({ ...state, processed: true }))
  .step('Continue', ({ state }) => ({ ...state, done: true }));
```

Key rules:
- Predicate returns `true` to continue, `false` to skip all remaining steps
- The predicate is synchronous and receives `{ state, options }`
- State type is unchanged after a guard
- Optional title as second argument: `.guard(predicate, 'Check condition')`
- See `/docs/brain-dsl-guide.md` for more details

## Brain DSL Type Inference

The Brain DSL has very strong type inference capabilities. **Important**: You should NOT explicitly specify types on the state object as it flows through steps. The types are automatically inferred from the previous step.

```typescript
// ❌ DON'T DO THIS - unnecessary type annotations
brain('example')
  .step('init', ({ state }: { state: {} }) => ({
    count: 0,
    name: 'test'
  }))
  .step('process', ({ state }: { state: { count: number; name: string } }) => ({
    ...state,
    processed: true
  }))

// ✅ DO THIS - let TypeScript infer the types
brain('example')
  .step('init', ({ state }) => ({
    count: 0,
    name: 'test'
  }))
  .step('process', ({ state }) => ({
    ...state,  // TypeScript knows state has count: number and name: string
    processed: true
  }))
```

The type inference flows through the entire chain, making the code cleaner and more maintainable.

## Error Handling in Brains

**Important**: Do NOT catch errors in brain steps unless error handling is specifically part of the brain's workflow logic. The brain runner handles all errors automatically.

```typescript
// ❌ DON'T DO THIS - unnecessary error catching
brain('example')
  .step('fetch data', async ({ state }) => {
    try {
      const data = await fetchSomeData();
      return { ...state, data };
    } catch (error) {
      console.error('Error:', error);
      return { ...state, error: error.message };
    }
  })

// ✅ DO THIS - let errors propagate
brain('example')
  .step('fetch data', async ({ state }) => {
    const data = await fetchSomeData(); // If this throws, the runner handles it
    return { ...state, data };
  })

// ✅ ONLY catch errors when it's part of the workflow logic
brain('validation-example')
  .step('validate input', async ({ state }) => {
    try {
      const result = await validateData(state.input);
      return { ...state, valid: true, result };
    } catch (validationError) {
      // Only if the next step needs to know about validation failures
      return { ...state, valid: false, validationError: validationError.message };
    }
  })
  .step('process based on validation', ({ state }) => {
    if (!state.valid) {
      // Handle validation failure as part of the workflow
      return { ...state, status: 'validation-failed' };
    }
    // Continue with valid data
    return { ...state, status: 'processing' };
  })
```

Most generated brains should not have try-catch blocks. Only use them when the error state is meaningful to subsequent steps in the workflow.

## UI Steps for Form Generation

When you need to collect user input, use the `.ui()` method. The pattern is:
1. `.ui()` generates the page
2. Next step gets `page.url` and `page.webhook`
3. Notify users, then use `.wait()` with `page.webhook`
4. Step after `.wait()` gets form data in `response`

```typescript
import { z } from 'zod';

brain('feedback-collector')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John',
  }))
  // Generate the form
  .ui('Collect Feedback', {
    template: (state) => <%= '\`' %>
      Create a feedback form for <%= '${state.userName}' %>:
      - Rating (1-5)
      - Comments textarea
      - Submit button
    <%= '\`' %>,
    responseSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
  })
  // Notify users
  .step('Notify', async ({ state, page, slack }) => {
    await slack.post('#feedback', `Fill out: <%= '${page.url}' %>`);
    return state;
  })
  // Wait for form submission
  .wait('Wait for submission', ({ page }) => page.webhook)
  // Form data comes through response (not page)
  .step('Process', ({ state, response }) => ({
    ...state,
    rating: response.rating,     // Typed from responseSchema
    comments: response.comments,
  }));
```

Key points:
- `page.url` - where to send users
- `page.webhook` - use with `.wait()` to pause for submission
- `response` - form data arrives here (in step after `.wait()`)
- You control how users are notified (Slack, email, etc.)

See `/docs/brain-dsl-guide.md` for more UI step examples.

## Service Organization

When implementing services for the project brain, consider creating a `services/` directory at the root of your project to keep service implementations organized and reusable:

```
services/
├── gmail.js         # Gmail API integration
├── slack.js         # Slack notifications
├── database.js      # Database client
└── analytics.js     # Analytics tracking
```

Then in your `brain.ts` (at the project root):

```typescript
import { createBrain } from '@positronic/core';
import gmail from './services/gmail.js';
import slack from './services/slack.js';
import database from './services/database.js';
import analytics from './services/analytics.js';

export const brain = createBrain({
  services: {
    gmail,
    slack,
    database,
    analytics
  }
});
```

This keeps your service implementations separate from your brain logic and makes them easier to test and maintain.

## Brain Options Usage

When creating brains that need runtime configuration, use the options schema pattern:

```typescript
import { z } from 'zod';

// Good example - configurable brain with validated options
const alertSchema = z.object({
  slackChannel: z.string(),
  emailEnabled: z.string().default('false'),
  alertThreshold: z.string().default('10')
});

const alertBrain = brain('Alert System')
  .withOptionsSchema(alertSchema)
  .step('Check Threshold', ({ state, options }) => ({
    ...state,
    shouldAlert: state.errorCount > parseInt(options.alertThreshold)
  }))
  .step('Send Alerts', async ({ state, options, slack }) => {
    if (!state.shouldAlert) return state;
    
    await slack.post(options.slackChannel, state.message);
    
    if (options.emailEnabled === 'true') {
      // Note: CLI options come as strings
      await email.send('admin@example.com', state.message);
    }
    
    return { ...state, alerted: true };
  });
```

Remember:
- Options from CLI are always strings (even numbers and booleans)
- Options are for configuration, not data
- Document available options in comments above the brain

## Important: ESM Module Imports

This project uses ES modules (ESM). **Always include the `.js` extension in your imports**, even when importing TypeScript files:

```typescript
// ✅ CORRECT - Include .js extension
import { brain } from '../brain.js';  // From a file in brains/ directory
import { analyzeData } from '../utils/analyzer.js';
import gmail from '../services/gmail.js';

// ❌ WRONG - Missing .js extension
import { brain } from '../brain';
import { analyzeData } from '../utils/analyzer';
import gmail from '../services/gmail';
```

This applies to all imports in:
- Brain files
- Service files
- Test files
- Any other TypeScript/JavaScript files

The `.js` extension is required for ESM compatibility, even though the source files are `.ts`.

## Creating New Brains - Test-Driven Development

**IMPORTANT**: When asked to generate or create a new brain, you should ALWAYS follow this test-driven development approach. This ensures the brain works correctly and helps catch issues early.

### 1. Write a Failing Test First

Start by following the brain testing guide (`/docs/brain-testing-guide.md`) and write a failing test that describes the expected behavior of the brain.

```typescript
// tests/my-new-brain.test.ts
import { describe, it, expect } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import myNewBrain from '../brains/my-new-brain.js';

describe('MyNewBrain', () => {
  it('should process data and return expected result', async () => {
    const mockClient = createMockClient();

    // Mock any AI responses if the brain uses prompts
    mockClient.mockResponses(
      { processedData: 'expected output' }
    );

    const result = await runBrainTest(myNewBrain, {
      client: mockClient,
      initialState: { input: 'test data' }
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.output).toBe('expected output');
  });
});
```

### 2. Review Documentation

Before implementing the brain:
- Re-read the **Brain DSL guide** (`/docs/brain-dsl-guide.md`) to understand the DSL patterns
- Re-read this **Tips for Agents** document if you haven't already
- Pay special attention to type inference and error handling guidelines

### 3. Start the Development Server

Before implementing, start the development server in detached mode so you can actually run and test your brain:

```bash
# For most cases, just use the default:
px server -d

# Verify the server is running
px brain list
```

If you need a custom port (e.g., when running multiple servers):
```bash
# 1. Generate a random port
PORT=$(echo $((30000 + RANDOM % 20000)))
echo "Using port: $PORT"

# 2. Start the server in detached mode (--log-file is required with --port)
px server --port $PORT --log-file /tmp/server-$PORT.log -d

# 3. Set environment variable for all subsequent px commands
export POSITRONIC_PORT=$PORT

# 4. Verify the server is running
px brain list
```

### 4. Implement Incrementally

Build the brain one step at a time, testing as you go. **Actually run the brain after each change** to see if it works:

```bash
# 1. Create the brain with just the first step
# Write minimal implementation in brains/my-new-brain.ts

# 2. Run the brain to test the first step
px brain run my-new-brain

# 3. Check the server log to see execution details
# For default server:
tail -f .positronic-server.log
# For custom port server:
# tail -f /tmp/server-$PORT.log

# 4. Run the test to see if it's getting closer to passing
npm test tests/my-new-brain.test.ts

# 5. Add the next step, run again, check logs
# Repeat until the test passes

# 6. When done, stop the server
px server -k  # (for default server) or: kill $(cat .positronic-server.pid)
```

### 5. Example Workflow

Here's a complete example of creating a brain that processes user feedback:

```typescript
// Step 1: Write the test first
describe('FeedbackProcessor', () => {
  it('should analyze feedback and generate response', async () => {
    const mockClient = createMockClient();
    mockClient.mockResponses(
      { sentiment: 'positive', score: 0.8 },
      { response: 'Thank you for your feedback!' }
    );

    const result = await runBrainTest(feedbackBrain, {
      client: mockClient,
      initialState: { feedback: 'Great product!' }
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.sentiment).toBe('positive');
    expect(result.finalState.response).toBeTruthy();
  });
});

// Step 2: Create minimal brain implementation
import { brain } from '../brain.js';
import { z } from 'zod';

const feedbackBrain = brain('feedback-processor')
  .step('Initialize', ({ state }) => ({
    ...state,
    timestamp: Date.now()
  }));

export default feedbackBrain;

// Step 3: Run and check logs, see it doesn't analyze yet
// Step 4: Add sentiment analysis step
  .prompt('Analyze sentiment', {
    template: ({ feedback }) =>
      <%= '\`Analyze the sentiment of this feedback: "${feedback}"\`' %>,
    outputSchema: {
      schema: z.object({
        sentiment: z.enum(['positive', 'neutral', 'negative']),
        score: z.number().min(0).max(1)
      }),
      name: 'sentimentAnalysis' as const
    }
  })

// Step 5: Run again, check logs, test still fails (no response)
// Step 6: Add response generation
  .prompt('Generate response', {
    template: ({ sentimentAnalysis, feedback }) =>
      <%= '\`Generate a brief response to this ${sentimentAnalysis.sentiment} feedback: "${feedback}"\`' %>,
    outputSchema: {
      schema: z.object({
        response: z.string()
      }),
      name: 'responseData' as const
    }
  })
  .step('Format output', ({ state }) => ({
    ...state,
    sentiment: state.sentimentAnalysis.sentiment,
    response: state.responseData.response
  }));

// Step 7: Run test - it should pass now!
```

### 6. Important Reminders

- Always start with a test that describes what the brain should do
- Start the development server in detached mode (`-d`) before implementing
- **Actually run the brain** after each change to verify it works
- Build incrementally - one step at a time
- Use the server logs to debug and understand execution
- Let TypeScript infer types - don't add explicit type annotations
- Don't catch errors unless it's part of the workflow logic
- Run `npm run typecheck` frequently to catch type errors early
- Stop the server when done: `px server -k` (default server) or `kill $(cat .positronic-server.pid)`