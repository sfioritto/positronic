# Tips for AI Agents

This document contains helpful tips and patterns for AI agents working with Positronic projects.

## TypeScript Compilation

Run `npx tsc` frequently as you make changes to ensure your TypeScript code compiles correctly. This will catch type errors early and help maintain code quality.

## Running the Development Server

When you need to run a development server, use the `--log-file` option to capture server output. **Important**: Always place the server log file in the `/tmp` directory so it gets cleaned up automatically by the operating system.

### 1. Start the server with logging

```bash
# Start server with random port and capture output to a log file in /tmp
PID=$(px server --port 38291 --log-file /tmp/server-38291.log &)

# The command outputs the process ID as the first line
# Store this PID for later use
```

### 2. Run commands using your server port

```bash
# Set the port environment variable for subsequent commands
export POSITRONIC_SERVER_PORT=38291

# Now all px commands will use your server
px brain list
px brain run my-brain
```

### 3. Check server logs when needed

```bash
# View the entire log file
cat /tmp/server-38291.log

# Follow the log file for real-time updates
tail -f /tmp/server-38291.log

# View last 50 lines
tail -n 50 /tmp/server-38291.log
```

### 4. Stop the server when done

```bash
# Use the PID you captured earlier
kill $PID
```

### Important Notes
- The log file must not already exist (prevents accidental overwrites)
- Each server instance should use a unique port and log file
- Always clean up by killing the server process when done
- The log file contains timestamped entries with [INFO], [ERROR], and [WARN] prefixes

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