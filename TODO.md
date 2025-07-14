## 1. Refactor CLI server.ts Command - Reduce Orchestration Logic

### Problem

The `server.ts` file in the CLI is acting as the conductor of the local dev experience, but it's holding too much logic itself rather than delegating to the appropriate backend packages.

**Current Behavior:**

- Finds the project
- Loads the backend package
- Calls `devServer.setup()` and `devServer.start()`
- Sets up its own chokidar watcher
- When files change, directly calls `syncResources` and `generateTypes`

**The Issue:**
The CLI is making assumptions about what should happen when files change. This logic is currently generic, but different backends (e.g., AWS) might need different actions on file change (e.g., re-bundling a Lambda function). The current design would require adding `if (backend === 'aws') { ... }` logic to the CLI.

### Suggested Solution

Make the `PositronicDevServer` interface richer. The CLI's job should be to detect changes and notify the server. The server's job is to know what to do with that notification.

**Proposed Interface Extension:**

```typescript
// In @positronic/spec/src/index.ts
export interface PositronicDevServer {
  // ... existing methods

  // The CLI calls this when it detects a resource file has changed.
  onResourceChange(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void>;

  // The CLI calls this when it detects a brain file has changed.
  onBrainChange(
    projectRoot: string,
    filePath: string,
    event: 'add' | 'change' | 'unlink'
  ): Promise<void>;
}
```

**Benefits:**

- The `CloudflareDevServer` would implement `onBrainChange` by calling its `regenerateManifestFile`
- The CLI's `server.ts` watcher becomes simpler: it just calls the appropriate method on the devServer instance
- Backend-specific logic moves into the backend package where it belongs
- Easier to add new backends without modifying CLI logic

### Implementation Steps

1. [ ] Update the `PositronicDevServer` interface in `@positronic/spec`
2. [ ] Implement the new methods in `CloudflareDevServer`
3. [ ] Refactor CLI `server.ts` to use the new interface methods
4. [ ] Remove direct calls to `syncResources` and `generateTypes` from CLI
5. [ ] Test the refactored implementation

## 2. Positronic Brain Development Issues

### Issues Encountered by AI Agent Creating a Hacker News Bot

#### Server Management & Output Visibility

- Couldn't start and monitor the server output
- Had to rely on user to see error messages from the server
- No way to see real-time logs when running brains
- **PUNT ON THIS FOR NOW**

#### AI Client API Confusion

- Initially tried using client.generateObject() directly in a step
- Didn't immediately recognize to use the .prompt() step pattern
- The Brain DSL guide showed the pattern, but didn't connect that this was THE way to use AI in Positronic

#### Missing Examples of Common Patterns

- No example of fetching external APIs (like Hacker News)
- No example of filtering/processing arrays with AI
- Would have helped to see a "real world" brain example beyond the basic ones

#### Type Definitions & Interfaces

- Had to guess the structure of HNArticle interface
- Wasn't sure what methods were available on the client parameter
- No clear documentation on what parameters are available in each step context

#### Error Debugging

- Error messages were cryptic (e.g., "Cannot read properties of undefined")
- No stack trace or context about which step failed
- Would benefit from better error messages that explain what went wrong

#### Testing & Running Brains

- No way to test brains in isolation
- Had to run the full brain to see if it worked
- No documentation on how to mock or test individual steps

#### Project Structure Understanding

- Wasn't immediately clear that brains go in /brains directory
- Had to infer the export pattern from the example

### Action Items

#### Documentation (Critical)

- [ ] Add "Common Patterns" doc with examples:
  - Fetching from external APIs
  - Using AI to filter/classify data
  - Error handling patterns
  - State management best practices
- [ ] Make .prompt() step documentation more prominent - clarify it's the primary way to use AI in brains
- [ ] Add type definitions or better inline docs showing:
  - What's available in step contexts (state, client, resources, etc.)
  - Return type expectations
  - Available methods on each parameter

#### Template Improvements

- [ ] Include an example brain in the template project (keeping in mind templating error issues)
  - Look at tests in core library for decently complicated example
  - Consider using Hacker News bot brain as example
  - Must use .prompt() step to demonstrate AI usage

#### Process Documentation

- [ ] Create a process guide for generating brains (similar to command line tools process)
  - Multi-step process
  - Include how to write tests
  - Provide test examples

#### Error Handling

- [ ] Improve error messages to explain:
  - Which step failed
  - Expected vs actual data
  - Hints about common fixes

#### Future Considerations

- Server output tool - Maybe a tool that lets agents see the last N lines of server output or brain execution logs (PUNTED)

## 3. Server Management for AI Agents

### Problem
AI agents need to:
- Start development servers with specific ports
- Capture server output to log files
- Track server process IDs
- Run multiple servers simultaneously without conflicts

### Solution
Modify the `px server` command (in local dev mode only) to support:
1. `--log-file <path>` option that redirects all console output to a specified file
2. When running in background mode with logging, output the process ID to stdout
3. Let AI agents manage their own PIDs and log file locations

### Implementation Plan

1. [ ] Add `--log-file` option to `px server` command (local dev mode only)
2. [ ] When log file is specified:
   - Check if file already exists, throw error if it does (prevent overwriting)
   - Redirect all console output (stdout and stderr) to the file
   - Output the process ID when starting
3. [ ] Update CLAUDE.md with instructions for AI agents:
   ```bash
   # Start server with random port and log file
   PID=$(px server --port 38291 --log-file ./server-38291.log &)
   
   # Run commands using the port
   POSITRONIC_SERVER_PORT=38291 px brain list
   
   # Check logs when needed
   cat ./server-38291.log
   
   # Kill server when done
   kill $PID
   ```

### Benefits
- Integrated into existing CLI tool
- No extra scripts or files to manage
- AI agents have full control over their server instances
- Simple bash commands (no custom tooling needed)
- Each agent can manage multiple servers if needed
