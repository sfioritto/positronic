# Tips for AI Agents

This document contains helpful tips and patterns for AI agents working with Positronic projects.

## TypeScript Compilation

Run `npm run typecheck` frequently as you make changes to ensure your TypeScript code compiles correctly. This will catch type errors early and help maintain code quality.

## Prefer Type Inference

Never add explicit type annotations unless `npm run typecheck` tells you to. TypeScript's inference is very strong — especially within the Brain DSL chain — and explicit types add noise without value.

Start by writing code with no annotations. If `typecheck` fails, add the minimum annotation or cast needed to fix it.

```typescript
// ❌ DON'T DO THIS - explicit types on callback parameters
.filter(([_, result]: [any, any]) => result !== null)
.map((pr: any) => pr.author)
.map((n: string) => n.trim())
error: (thread: any, error: any) => { ... }

// ✅ DO THIS - let inference work
.filter(([_, result]) => result !== null)
.map(pr => pr.author)
.map(n => n.trim())
error: (thread, error) => { ... }
```

This also applies to variable declarations and function parameters:

```typescript
// ❌ DON'T DO THIS
const names: string[] = options.notify.split(',');
message: ({ state }: any) => { ... }

// ✅ DO THIS
const names = options.notify.split(',');
message: ({ state }) => { ... }
```

If you genuinely need a cast to fix a type error, prefer the narrowest cast possible and add it only after seeing the error.

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

**Guards vs exceptions**: Use guards for conditions that are an expected part of the brain's flow — like "no audio URL was found" after a discovery step. Guards are documented in the DSL and show up when viewing the brain's steps. Reserve `throw` for truly unexpected errors. If a missing value is a normal possible outcome of a previous step, handle it with a guard, not an exception.

```typescript
// ❌ DON'T DO THIS - throwing for an expected outcome
.step('Transcribe', async ({ state }) => {
    if (!state.discovery.audioUrl) {
      throw new Error('No audio URL found');
    }
    const transcript = await whisper.transcribe(state.discovery.audioUrl);
    return { ...state, transcript };
  })

// ✅ DO THIS - guard for expected flow, keep the step focused
.guard(({ state: { discovery } }) => !!discovery.audioUrl, 'Has audio URL')
.step('Transcribe', async ({ state: { discovery } }) => {
    const transcript = await whisper.transcribe(discovery.audioUrl!);
    return { ...state, transcript };
  })
```

## Destructure State in Steps

Always destructure properties off of `state` rather than accessing them through `state.property`. This applies to steps, prompt templates, brain callbacks, and guards — anywhere state is accessed.

```typescript
// ❌ DON'T DO THIS - accessing properties through state
.brain('Find data', ({ state }) => ({
    prompt: `Process <%= '${state.user.name}' %> from <%= '${state.user.email}' %>`,
  }))

// ✅ DO THIS - destructure in the parameter when state itself isn't needed
.brain('Find data', ({ state: { user } }) => ({
    prompt: `Process <%= '${user.name}' %> from <%= '${user.email}' %>`,
  }))
```

The same applies to prompt templates:

```typescript
// ❌ DON'T DO THIS
message: ({ state }) => `Hello <%= '${state.user.name}' %>, your order <%= '${state.order.id}' %> is ready.`,

// ✅ DO THIS
message: ({ state: { user, order } }) => `Hello <%= '${user.name}' %>, your order <%= '${order.id}' %> is ready.`,
```

When you still need `state` (e.g. for `...state` in the return value), destructure in the function body instead:

```typescript
// ❌ DON'T DO THIS
.step('Format', ({ state }) => ({
    ...state,
    summary: `<%= '${state.title}' %> by <%= '${state.author}' %>`,
  }))

// ✅ DO THIS - destructure in the body when you also need ...state
.step('Format', ({ state }) => {
    const { title, author } = state;
    return {
      ...state,
      summary: `<%= '${title}' %> by <%= '${author}' %>`,
    };
  })
```

## JSX for Prompt Templates

For complex, multi-line prompts, use JSX instead of template literals. Rename the file to `.tsx` and return JSX from the template function:

```tsx
// Before (template literal — hard to read when indented in builder chain)
message: ({ state: { user, order } }) =>
  `Hello <%= '${user.name}' %>, your order <%= '${order.id}' %> is ready.
<%= '${order.isExpress ? "\\nThis is an express order." : ""}' %>`,

// After (JSX — Prettier manages indentation, conditionals are clean)
message: ({ state: { user, order } }) => (
  <>
    Hello {user.name}, your order {order.id} is ready.
    {order.isExpress && <>This is an express order.</>}
  </>
)
```

See `/docs/brain-dsl-guide.md` for full JSX template documentation including loops, reusable components, and async components for resource loading.

## State Shape

### Each step should have one clear purpose, and add one thing to state

Don't let steps do multiple unrelated things. Each step should have a clear name that describes its single purpose, and it should add one key to state. If a step produces multiple data points, namespace them under a single key.

```typescript
// ❌ DON'T DO THIS - step does too much and adds multiple keys
.step('Process', async ({ state }) => ({
    ...state,
    transcript: await transcribe(state.audioUrl),
    episodeTitle: state.discovery.episodeTitle,
    podcastName: state.podcast.source,
    podcastUrl: state.podcast.url,
  }))

// ✅ DO THIS - step has one purpose, adds one thing
.step('Transcribe', async ({ state }) => {
    const { discovery } = state;
    const transcript = await whisper.transcribe(discovery.audioUrl!);
    return { ...state, transcript };
  })
```

Previous steps already namespace their results on state (e.g. `state.discovery`, `state.podcast`). Don't copy their fields to the top level — it duplicates data and makes it unclear which version is canonical.

### Reshape state at phase boundaries

As steps build up state, it can accumulate intermediate artifacts. At major phase transitions in a brain — like going from "gathering data" to "analyzing it" — reshape state to a clean form for the next phase. Return only what the next phase needs instead of spreading everything forward.

The smell to watch for: if you're reading a brain and can't quickly answer "what's the canonical version of X on state?" then state needs reshaping.

```typescript
// After a data-gathering phase, clean up for analysis
.step('Prepare for analysis', ({ state }) => {
    const { discovery, transcript, podcast } = state;
    // Only carry forward what the analysis phase needs
    return { podcast, discovery, transcript };
  })
```

## Iterate Results

Iterate steps produce an `IterateResult` — use its properties and methods to access results cleanly:

```typescript
// Access just the results
state.results.values.map(r => r.summary)

// Access just the input items
state.results.items

// Filter by both item and result
state.results.filter((item, r) => r.isImportant).items

// Map over both item and result
state.results.map((item, r) => ({ id: item.id, summary: r.summary }))

// Tuple destructuring still works (backward compatible)
for (const [item, result] of state.results) { ... }
```

Use `.values` for simple extraction, `.filter()` for correlated filtering, and `.map()` when you need both item and result:

```typescript
.step('Process', ({ state }) => ({
    ...state,
    important: state.results.filter((item, r) => r.score > 0.8).items,
    summaries: state.results.values.map(r => r.summary),
  }))
```

**Name the `stateKey` after the content.** The stateKey is now the 2nd argument to `.map()`. If results contain analyses, use `.map('title', 'analyses', { ... })`, not `.map('title', 'processedItems', { ... })`.

### Naming convention for filter/map parameters

`IterateResult.filter()` and `.map()` take two parameters: the input item and the AI result. **Name them after what they represent**, not generic names like `item` and `r`:

```typescript
// ❌ DON'T DO THIS - generic parameter names
state.validations.filter((item, r) => r.matches)
state.transcripts.filter((t) => t.hasTranscript)  // WRONG: single param is the item, not the result

// ✅ DO THIS - descriptive names that reflect the data
state.validations.filter((crawledResult, validation) => validation.matches)
state.transcripts.filter((match, extraction) => extraction.hasTranscript)
```

The first parameter is always the input item (what you passed to `over`), and the second is the AI's output (what the `outputSchema` describes). A single-parameter callback only receives the item — if you need the AI result, you must use both parameters.

### Nested brain state spreading

When a `.brain()` step runs an inner brain, the inner brain's final state is spread directly onto the outer state:

```typescript
.brain('Search and validate', searchAndValidate)
```

All properties from the inner brain's final state are merged onto the outer state. Subsequent steps can access those properties directly (e.g., `state.matches`). The inner brain's state type is fully inferred from its definition, so you get full type safety.

If you want namespacing (to avoid collisions with existing state properties), design the inner brain to return a namespaced state shape:

```typescript
// Inner brain returns its results under a single key
const searchAndValidate = brain('search-and-validate')
  .step('Search', ({ state }) => ({ ...state, matches: [] }))
  .step('Package', ({ state }) => ({
    searchResults: { matches: state.matches }
  }));

// Outer brain accesses via state.searchResults.matches
brain('parent')
  .step('Init', () => ({ query: 'test' }))
  .brain('Search and validate', searchAndValidate)
  .step('Use results', ({ state }) => ({
    ...state,
    count: state.searchResults.matches.length,
  }));
```

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

### Brains that receive initial state from outside

If a brain receives its initial state from the outside — via `.map()`, `.brain()`, or `run({ initialState })` — declare the state type in the generic parameters:

```typescript
// This brain is used inside .map() — it receives thread data as initial state
const categorizeBrain = brain<{}, RawThread>('categorize-thread')
  .prompt('Categorize', {
    message: ({ state }) => `Categorize: <%= '${state.subject}' %>`,
    outputSchema: z.object({ category: z.string() }),
  });

// The parent brain maps over threads
brain('email-digest')
  .step('Fetch', async () => ({ threads: await fetchThreads() }))
  .map('Categorize', 'categorized', {
    run: categorizeBrain,
    over: ({ state }) => state.threads,
    initialState: (thread) => thread,
  });
```

Without the generic, `TState` defaults to `object` and steps can't see any properties. The generic tells TypeScript "this brain starts with this shape." If the brain builds its own state from nothing (first step returns the initial shape), skip the generic — inference handles it.

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

## Page Steps for Forms

When you need to collect user input, use the `.page()` method with `html` and `formSchema`. The brain auto-suspends after creating the page, then auto-merges the form response directly onto state. Use the `onCreated` callback for side effects.

```tsx
import { z } from 'zod';
import { Form } from '@positronic/core';

brain('feedback-collector')
  .step('Initialize', ({ state }) => ({
    ...state,
    userName: 'John',
  }))
  .page('Collect Feedback', ({ state, slack }) => ({
    html: (
      <Form>
        <h2>Feedback for {state.userName}</h2>
        <label>Rating (1-5) <input name="rating" type="number" min="1" max="5" required /></label>
        <label>Comments <textarea name="comments" required /></label>
        <button type="submit">Submit</button>
      </Form>
    ),
    formSchema: z.object({
      rating: z.number().min(1).max(5),
      comments: z.string(),
    }),
    onCreated: async (page) => {
      await slack.post('#feedback', `Fill out: <%= '${page.url}' %>`);
    },
  }))
  // No .handle() needed — form data auto-merges directly onto state
  .step('Process', ({ state }) => ({
    ...state,
    // state.rating and state.comments are typed
    processed: true,
  }));
```

Key points:
- `page` is available inside the `onCreated` callback, not in a separate step
- `page.url` - where to send users
- The brain auto-suspends after `.page()` with `formSchema`
- Form data is spread directly onto state (e.g., `state.rating`, `state.comments`)
- You control how users are notified (Slack, email, etc.) inside `onCreated`

See `/docs/brain-dsl-guide.md` for more page step examples.

## Plugin Organization

When implementing plugins for the project brain, keep plugin implementations in the `src/plugins/` directory to stay organized and reusable:

```
src/plugins/
├── gmail.ts         # Gmail API integration
├── slack.ts         # Slack notifications
├── database.ts      # Database client
└── analytics.ts     # Analytics tracking
```

Then in your `src/brain.ts`:

```typescript
import { createBrain } from '@positronic/core';
import { gmail } from './plugins/gmail.js';
import { slack } from './plugins/slack.js';
import { database } from './plugins/database.js';
import { analytics } from './plugins/analytics.js';

export const brain = createBrain({
  plugins: [gmail, slack, database, analytics],
});
```

Each plugin is defined with `definePlugin` from `@positronic/core`. See `/docs/plugin-guide.md` for how to create plugins with typed config, tools, and adapters.

This keeps your plugin implementations separate from your brain logic and makes them easier to test and maintain.

## Rate Limiting with bottleneck

Most external APIs have rate limits. The `utils/bottleneck.ts` utility creates a simple rate limiter you can wrap around any async call.

### Basic Usage

```typescript
import { bottleneck } from '../utils/bottleneck.js';

// Create a limiter — exactly one rate unit is required
const limit = bottleneck({ rpm: 60 }); // 60 requests per minute

// Wrap any async call with the limiter
const result = await limit(() => api.fetchData(id));
```

### Config Options

Pass exactly one of these (TypeScript enforces this):

- `rps` — requests per second
- `rpm` — requests per minute
- `rph` — requests per hour
- `rpd` — requests per day

```typescript
const fast = bottleneck({ rps: 10 });   // 10 per second
const slow = bottleneck({ rpd: 1000 }); // 1000 per day
```

### Wrapping a Service

Create one limiter per API and wrap all calls through it:

```typescript
// src/services/github.ts
import { bottleneck } from '../utils/bottleneck.js';

const limit = bottleneck({ rps: 10 });

async function getRepo(owner: string, repo: string) {
  return limit(() =>
    fetch('https://api.github.com/repos/' + owner + '/' + repo)
      .then(r => r.json())
  );
}

async function listIssues(owner: string, repo: string) {
  return limit(() =>
    fetch('https://api.github.com/repos/' + owner + '/' + repo + '/issues')
      .then(r => r.json())
  );
}

export default { getRepo, listIssues };
```

### Using with Iterate

When iterating over items, wrap the API call inside the step callback:

```typescript
import { bottleneck } from '../utils/bottleneck.js';

const limit = bottleneck({ rpm: 60 });

brain('process-items')
  .step('Init', ({ state }) => ({ items: state.items }))
  .step('Fetch details', async ({ state }) => {
    const details = await Promise.all(
      state.items.map(item => limit(() => api.getDetail(item.id)))
    );
    return { ...state, details };
  });
```

### When Creating Services

When building a new service that wraps an external API, research the API's rate limits and add a bottleneck upfront. It's much easier to add rate limiting from the start than to debug 429 errors later.

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
  .withOptions(alertSchema)
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
import { brain } from '../brain.js';  // From a file in src/brains/ (brain.ts is at src/brain.ts)
import { analyzeData } from '../utils/analyzer.js';  // From src/brains/ to src/utils/
import gmail from '../services/gmail.js';  // From src/brains/ to src/services/

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
import myNewBrain from '../src/brains/my-new-brain.js';

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
# Write minimal implementation in src/brains/my-new-brain.ts

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
    message: ({ state: { feedback } }) =>
      <%= '\`Analyze the sentiment of this feedback: "${feedback}"\`' %>,
    outputSchema: z.object({
      sentiment: z.enum(['positive', 'neutral', 'negative']),
      score: z.number().min(0).max(1)
    }),
  })

// Step 5: Run again, check logs, test still fails (no response)
// Step 6: Add response generation
  .prompt('Generate response', {
    message: ({ state: { sentiment, feedback } }) =>
      <%= '\`Generate a brief response to this ${sentiment} feedback: "${feedback}"\`' %>,
    outputSchema: z.object({
      response: z.string()
    }),
  });

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
