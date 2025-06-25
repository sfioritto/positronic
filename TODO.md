# TODO

## 2. Refactor CLI server.ts Command - Reduce Orchestration Logic

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
