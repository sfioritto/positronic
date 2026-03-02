# @positronic/cli

## 0.0.67

### Patch Changes

- - Add timezone support to the schedule system (CLI, spec, and Cloudflare backend)
  - Fix AgentTool type variance to accept specifically-typed tools
  - Fix flaky signal tests by using SSE stream instead of setTimeout
  - Allow git log and git blame in Claude settings
- Updated dependencies
  - @positronic/core@0.0.67
  - @positronic/spec@0.0.67
  - @positronic/template-new-project@0.0.67

## 0.0.66

### Patch Changes

- Fix wait timeout: add RESUMED transition from waiting state to prevent state machine errors when a brain resumes after a wait timeout. Add comprehensive integration tests for wait timeout functionality and extract shared SSE test helpers for reuse across test suites.
- Updated dependencies
  - @positronic/core@0.0.66
  - @positronic/spec@0.0.66
  - @positronic/template-new-project@0.0.66

## 0.0.65

### Patch Changes

- Add configurable timeout for `.wait()` steps: pass `{ timeout: '24h' }` (or milliseconds) to automatically cancel a brain if a webhook response isn't received within the deadline. Includes new `parseDuration` utility, `TimeoutAdapter` for Cloudflare DO alarm-based timeout enforcement, and `waitForWebhook` agent tool.
- Updated dependencies
  - @positronic/core@0.0.65
  - @positronic/spec@0.0.65
  - @positronic/template-new-project@0.0.65

## 0.0.64

### Patch Changes

- - Add local dev-mode auth: store selected SSH key in `.positronic-auth.json` at project root for per-project key selection during local development
  - Add CSRF token protection for webhook form submissions with spec coverage for token rejection
  - Move `parseFormData` and `validateWebhookToken` to core package for reuse across backends
  - Remove custom rate limit retry infrastructure in favor of SDK built-in retry; replace stacked retries with shared rate limiter and concurrency pool
  - Simplify Vercel client implementation
- Updated dependencies
  - @positronic/core@0.0.64
  - @positronic/spec@0.0.64
  - @positronic/template-new-project@0.0.64

## 0.0.63

### Patch Changes

- Replace step-level `waitFor` with dedicated `.wait()` builder method for cleaner webhook/event handling in Brain DSL. Instead of returning `{ state, waitFor: [...] }` from steps, brains now use a `.wait('name', () => webhook(...))` chain method, improving readability and separating concerns between state updates and event subscriptions.
- Updated dependencies
  - @positronic/core@0.0.63
  - @positronic/spec@0.0.63
  - @positronic/template-new-project@0.0.63

## 0.0.62

### Patch Changes

- - Replace .if().then().else() with .guard() for conditional branching in Brain DSL
  - Overhaul batch processing: chunk-based execution with alarm-based DO restart, fix null entries after JSON round-trip, stop emitting PAUSED between chunks, fix webhook rejection after restart
  - Enable authentication everywhere (local dev + tests); make pages and bundles public; skip auth for form submissions
  - Move retry logic from framework to client SDKs; add rate limit retry with exponential backoff to Vercel client
  - Add Link component to gen-ui-components
  - Replace deprecated generateObject with generateText + Output.object; fix generateUI hanging
  - Add toolChoice parameter for agent steps; add createAuthenticatedFetch helper
- Updated dependencies
  - @positronic/core@0.0.62
  - @positronic/spec@0.0.62
  - @positronic/template-new-project@0.0.62

## 0.0.61

### Patch Changes

- - Add JWT authentication to EventSource connections for secure real-time streaming in production deployments
  - Add observability configuration to Cloudflare template wrangler for improved logging and monitoring
- Updated dependencies
  - @positronic/core@0.0.61
  - @positronic/spec@0.0.61
  - @positronic/template-new-project@0.0.61

## 0.0.60

### Patch Changes

- - Add ssh-agent fallback for encrypted SSH keys, allowing users with passphrase-protected keys to authenticate without entering their passphrase for every request
  - Fix Ed25519 key support by properly converting to PKCS8/JWK format for Node.js crypto compatibility
  - Improve auth error surfacing with clearer error messages when SSH key loading fails
- Updated dependencies
  - @positronic/core@0.0.60
  - @positronic/spec@0.0.60
  - @positronic/template-new-project@0.0.60

## 0.0.59

### Patch Changes

- Replace RFC 9421 HTTP Message Signatures with JWT-based authentication

  - Switched from RFC 9421 HTTP Message Signatures to simpler JWT-based auth for API requests
  - Added new JwtAuthProvider class using the jose library for signing short-lived JWTs with SSH keys
  - Simplified auth middleware to verify JWTs instead of complex HTTP signature parsing
  - Removed dependency on @misskey-dev/node-http-message-signatures
  - Supports RSA, ECDSA (P-256, P-384, P-521), and Ed25519 key types
  - Improved auth test coverage with dedicated integration tests

- Updated dependencies
  - @positronic/core@0.0.59
  - @positronic/spec@0.0.59
  - @positronic/template-new-project@0.0.59

## 0.0.58

### Patch Changes

- Add root public key authentication setup flow

  - Add `px auth format-jwk-key` command to convert SSH public keys to JWK format for root authentication
  - Refactor auth error handling in useApi hooks to reduce duplication and improve error messages
  - Fix silent error swallowing in fetchAuthSetupInstructions
  - Add secrets API spec tests for root public key management
  - Remove obsolete R2 overflow tests

- Updated dependencies
  - @positronic/core@0.0.58
  - @positronic/spec@0.0.58
  - @positronic/template-new-project@0.0.58

## 0.0.57

### Patch Changes

- ## New Features

  ### SSH Key Authentication

  - Add `px auth` command for managing local SSH key configuration
  - Implement SSH public key authentication using RFC 9421 HTTP Message Signatures
  - Add user management commands (`px users create`, `px users list`, `px users delete`)
  - Add SSH key management (`px users keys add`, `px users keys list`, `px users keys remove`)

  ### Signal System for Brain Interruption

  - Add signal handling to pause, resume, and stop running brains
  - Add signal endpoints for Cloudflare backend
  - Add message interface to watch component for sending USER_MESSAGE signals
  - Implement RESUMED event for proper resume from pause state

  ### Memory System with Mem0 Integration

  - Add new `@positronic/mem0` package for memory integration
  - Add memory system documentation and examples to project template
  - Support scoped memory for brain contexts

  ### Watch Command Improvements

  - Add state view to watch command
  - Add event navigation, detail views, and token tracking
  - Add pause/resume UI with status tracking
  - Refactor watch.tsx to use robot3 state machine

  ## Improvements

  - Add R2 overflow storage for large brain events
  - Add outputSchema support for agent steps
  - Add maxIterations limit and token tracking to agent steps
  - Add dry-run binding resolution to validate_template tool
  - Add persist option and explicit data parameter to generateUI tool
  - Add print tool for user communication
  - Auto-generate done tool for every agent step
  - Improve default tool descriptions for better LLM decision-making
  - Refactor brain state machine from tree to flat map + stack
  - Split BrainRunner.run() into separate run() and resume() methods
  - Optimize MonitorDO event processing from O(N²) to O(1)

  ## Bug Fixes

  - Fix flaky CLI tests by using global nock setup and waiting for actual SSE events
  - Fix page cleanup when killing paused or zombie brains
  - Fix USER_MESSAGE signals being lost during webhook resume
  - Fix tool call history preservation in conversation messages
  - Fix nested brain webhook resume

- Updated dependencies
  - @positronic/core@0.0.57
  - @positronic/spec@0.0.57
  - @positronic/template-new-project@0.0.57

## 0.0.56

### Patch Changes

- - Add events view to watch command for real-time monitoring of brain events
  - Fix generateUI tool to properly generate UI pages
  - Fix AgentTool type variance issue in createBrain
- Updated dependencies
  - @positronic/core@0.0.56
  - @positronic/spec@0.0.56
  - @positronic/template-new-project@0.0.56

## 0.0.55

### Patch Changes

- - Add `createTool` helper function for creating tools with proper type inference
  - Add `consoleLog` and `done` default tools for debugging and task completion
  - Make agent `prompt` optional, defaulting to "Begin." when not provided
  - Add hello example brain demonstrating agent usage with default tools
  - Fix template project documentation to match current API
- Updated dependencies
  - @positronic/core@0.0.55
  - @positronic/spec@0.0.55
  - @positronic/template-new-project@0.0.55

## 0.0.54

### Patch Changes

- - Update to AI SDK v6 (from v5) for improved AI model support
  - Move component bundling machinery into .positronic/ directory for cleaner project structure
  - Switch project template to use Google Gemini as default provider
  - Add GOOGLE_GENERATIVE_AI_API_KEY to environment template
- Updated dependencies
  - @positronic/core@0.0.54
  - @positronic/spec@0.0.54
  - @positronic/template-new-project@0.0.54

## 0.0.53

### Patch Changes

- ## New Features

  - **UI Step System**: Add complete UI step implementation with YAML-based UI generation, Tailwind components, and form webhooks for building interactive AI workflows
  - **Agent Steps**: Rename `loop` to `agent` with new `.brain()` step overloads for nested brain execution
  - **createBrain Helper**: Add `createBrain` helper function and `brain()` function overloads for more flexible brain definition
  - **Batch Prompt Support**: Add batch prompt support to Brain DSL
  - **streamText Method**: Add `streamText` method to ObjectGenerator interface for streaming responses
  - **New Components**: Add HiddenInput component, improve Checkbox value typing, add validation requiring Form components to have a Button

  ## Improvements

  - **Modular Architecture**: Reorganize brain.ts into modular directory structure for better maintainability
  - **Cloudflare API Refactor**: Split monolithic api.ts into separate modules (brains, bundle, pages, resources, secrets, webhooks)
  - **Better Type Safety**: Fix State type to allow TypeScript interfaces in brain state, make responseSchema optional in prompt()
  - **Production Bundle Upload**: Add production bundle upload to deploy and bundle API spec
  - **Schema-First Props**: Add schema-first props to UIComponent for better LLM documentation

  ## Bug Fixes

  - Fix components not propagating through brain method chain
  - Fix UIComponent type variance in generateUI function
  - Fix UI step pattern to use waitFor for form submissions
  - Fix SQLITE_TOOBIG by removing initialState from RESTART events
  - Fix Heading level enum for Gemini API compatibility
  - Fix componentBundle for Cloudflare Workers compatibility
  - Fix typecheck errors for streamText and gen-ui-components

  ## Internal Changes

  - Remove unused heartbeat event system
  - Remove BrainFactory, add BrainConfig type
  - Remove internal-only exports from @positronic/core and @positronic/cloudflare
  - Add new @positronic/gen-ui-components package

- Updated dependencies
  - @positronic/core@0.0.53
  - @positronic/spec@0.0.53
  - @positronic/template-new-project@0.0.53

## 0.0.52

### Patch Changes

- ## New Features

  - Add `px top` command for live-updating view of running brains with interactive navigation
  - Add kill functionality from watch and list views with confirmation prompts
  - Add vim-style navigation (j/k) to top command
  - Add 'r' shortcut alias for 'run' command
  - Unify watch command interface - now accepts brain name, run ID, or interactive selection

  ## Improvements

  - Extract reusable SelectList component for disambiguation UI
  - Refactor brain state machine to use nested tree structure for better organization
  - Refactor WatchResolver to use robot3 state machine for cleaner async handling
  - Add events option to createBrainExecutionMachine for state replay

  ## Bug Fixes

  - Fix terminal raw mode not restored after Ctrl-C on px server
  - Fix MonitorDO showing incorrect status when inner brain completes

- Updated dependencies
  - @positronic/core@0.0.52
  - @positronic/spec@0.0.52
  - @positronic/template-new-project@0.0.52

## 0.0.51

### Patch Changes

- Add webhook documentation to project template

  - Added comprehensive webhook documentation to the CLAUDE.md template
  - Documents webhook creation with `createWebhook()` and Zod schema validation
  - Explains how to use webhooks in brains with `waitFor`
  - Describes auto-discovery from `/webhooks` directory
  - Updated project structure to include `/webhooks` directory

- Updated dependencies
  - @positronic/core@0.0.51
  - @positronic/spec@0.0.51
  - @positronic/template-new-project@0.0.51

## 0.0.50

### Patch Changes

- ### Auto-discover webhooks from `webhooks/` directory

  Webhooks are now automatically discovered from the `webhooks/` directory, following the same pattern as brains. Previously, webhooks had to be manually registered via `setWebhookManifest()`.

  **New behavior:**

  - Place webhook files in your project's `webhooks/` directory
  - Each webhook should be a default export using `createWebhook()`
  - The dev server automatically generates `_webhookManifest.ts`
  - The generated manifest is imported and registered in your `.positronic/src/index.ts`

  **Example webhook file (`webhooks/my-webhook.ts`):**

  ```typescript
  import { createWebhook } from '@positronic/core';
  import { z } from 'zod';

  const myWebhook = createWebhook(
    'my-webhook',
    z.object({ data: z.string() }),
    async (request) => {
      const body = await request.json();
      return {
        type: 'webhook',
        identifier: body.id,
        response: { data: body.data },
      };
    }
  );

  export default myWebhook;
  ```

  This change also improves error handling when webhooks are not found, returning a 404 with "Webhook 'name' not found" instead of a 500 error.

## 0.0.49

### Patch Changes

- Bug fixes:
  - Fixed "Webhook manifest not initialized" error by defaulting webhookManifest to empty object
  - Added setWebhookManifest to project template so new projects are ready for webhook usage
- Updated dependencies
  - @positronic/core@0.0.49
  - @positronic/spec@0.0.49
  - @positronic/template-new-project@0.0.49

## 0.0.48

### Patch Changes

- Bug fixes and improvements:
  - Fixed infinite loop in the brain state machine
  - Fixed ESM/CJS interop issue with robot3 import
  - Reverted patches removal from events for proper watch client functionality
  - Improved test stability with increased timeouts
  - Removed unused currentState property from brain
- Updated dependencies
  - @positronic/core@0.0.48
  - @positronic/spec@0.0.48
  - @positronic/template-new-project@0.0.48

## 0.0.47

### Patch Changes

- - **Major refactor**: Introduced a state machine (using robot3) to manage brain execution complexity, replacing the previous imperative approach
  - **Bug fix**: Fixed an inner brain resume bug that could cause issues when resuming nested brain executions
  - **Improved watch component**: Refactored the CLI watch component to use the new state machine, simplifying the code and improving reliability
  - **Documentation access**: Added support for fetching content from documentation sites
  - **Updated examples**: Brain example now demonstrates using the client directly in a step
- Updated dependencies
  - @positronic/core@0.0.47
  - @positronic/spec@0.0.47
  - @positronic/template-new-project@0.0.47

## 0.0.46

### Patch Changes

- Fix inner brain webhook resume and loop webhook resume

  - Fixed webhook resume for inner brains by properly tracking brain nesting through event history
  - Fixed webhook resume for loop steps that pause on webhooks
  - Changed event query from DESC to ASC ordering to correctly identify the outer brain's start event
  - Added comprehensive event replay logic that builds nested `initialCompletedSteps` by tracking brain stack levels
  - Added tests for webhook resume scenarios with inner brains and loops

- Updated dependencies
  - @positronic/core@0.0.46
  - @positronic/spec@0.0.46
  - @positronic/template-new-project@0.0.46

## 0.0.45

### Patch Changes

- Fix nested brain pages parameter and improve test stability

  - Fixed a bug where the `pages` service was not passed to nested brains, causing pages to be unavailable in inner brain steps
  - Added comprehensive test to verify all step context parameters are passed to nested brains
  - Improved watch test stability by asserting on SSE step data instead of transient connection messages

- Updated dependencies
  - @positronic/core@0.0.45
  - @positronic/spec@0.0.45
  - @positronic/template-new-project@0.0.45

## 0.0.44

### Patch Changes

- ### CLI Improvements

  - **Redesigned `show` command**: Now displays brain information with fuzzy matching support. Use `show <brain>` to view brain info or `show --run-id <id>` for run details. Added `--steps` flag to display step structure.

  - **Redesigned `watch` UI**: Full-screen mode with minimal step view for better usability. Inner brains are now rendered nested under parent steps for clearer hierarchy.

  - **Fixed brain kill confirmation flow**: Resolved issue where confirmation input wasn't being processed correctly.

  - **Improved error handling**: Refactored watch component to use shared ErrorComponent for consistent error display.

- Updated dependencies
  - @positronic/core@0.0.44
  - @positronic/spec@0.0.44
  - @positronic/template-new-project@0.0.44

## 0.0.43

### Patch Changes

- Fix kill() to trust API-provided brainRunId over potentially corrupted DO SQLite state

  When killing zombie brain runs, the DO's SQLite could contain stale/corrupted data with a different brainRunId. This caused kill() to query MonitorDO with the wrong ID, resulting in "Brain run is not active or already completed" errors even for runs that were still showing as "running".

  Now kill() uses the brainRunId passed from the API (which already verified the run exists in MonitorDO) and only falls back to querying SQLite when no brainRunId is provided.

- Updated dependencies
  - @positronic/core@0.0.43
  - @positronic/spec@0.0.43
  - @positronic/template-new-project@0.0.43

## 0.0.42

### Patch Changes

- Bug fixes and improvements:

  - Fix kill() to handle zombie brain runs with missing DO state - brain runs killed by IoContext timeout can now be properly cancelled even when their DO state is corrupted
  - Fix watch showing 'brain complete' when inner brain finishes instead of waiting for outer brain
  - Fix terminal raw mode not restored after Ctrl+C on dev server
  - Fix Ink terminal rendering to overwrite instead of append
  - Add array waitFor support for loop tools allowing multiple webhooks (first response wins)
  - Add default system prompt for loops explaining tool execution behavior and webhook pausing

- Updated dependencies
  - @positronic/core@0.0.42
  - @positronic/spec@0.0.42
  - @positronic/template-new-project@0.0.42

## 0.0.41

### Patch Changes

- Add heartbeat events to keep Durable Objects alive during long-running operations

  - Add HEARTBEAT event type that is emitted every 5 seconds during LLM API calls, step actions, and tool executions to prevent Cloudflare Durable Objects from timing out
  - Fix schedule list/delete commands exiting before React components finish rendering
  - Add comprehensive API error handling tests for brain runs

- Updated dependencies
  - @positronic/core@0.0.41
  - @positronic/spec@0.0.41
  - @positronic/template-new-project@0.0.41

## 0.0.40

### Patch Changes

- Improve brain search with fuse.js fuzzy matching

  - Replace simple substring matching with fuse.js for proper fuzzy brain name matching
  - Add exact match priority for brain title and filename lookups
  - Weight brain title and filename higher than description in fuzzy search results
  - Return single best match when score is significantly better than alternatives

- Updated dependencies
  - @positronic/core@0.0.40
  - @positronic/spec@0.0.40
  - @positronic/template-new-project@0.0.40

## 0.0.39

### Patch Changes

- Add fuzzy brain search and disambiguation to CLI

  - **Fuzzy brain search**: Commands now accept brain titles, filenames, or search terms instead of just filenames. When multiple brains match, an interactive disambiguation UI lets you choose the correct one.
  - **Updated commands**: `run`, `watch`, `history`, `rerun`, and `schedule create` all support the new fuzzy search with the renamed `<brain>` argument.
  - **New search endpoint**: Added `GET /brains?q=<query>` for searching brains by title, filename, or description.
  - **Improved brain list display**: Shows Brain/Description columns with wrapped text instead of redundant filename column.
  - **Fix webhook-suspended brain killing**: Properly handle killing brains that are suspended waiting for webhooks (previously returned 409 error).
  - **Fix loop config function**: The loop config function no longer incorrectly receives webhook response data when resuming from a webhook.

- Updated dependencies
  - @positronic/core@0.0.39
  - @positronic/spec@0.0.39
  - @positronic/template-new-project@0.0.39

## 0.0.38

### Patch Changes

- Add loop() step for agentic LLM workflows

  - **New `loop()` step**: Create agentic workflows where an LLM runs iteratively with tools until completion
    - Supports tool definitions with Zod schemas
    - Terminal tools to signal loop completion
    - `waitFor` tools that pause execution and resume via webhooks
    - Configurable token limits and iteration tracking
    - Comprehensive event system for loop lifecycle (start, iteration, tool calls, completion)
  - **Anthropic client**: Add `generateText` method to support loop step tool calling
  - **Webhook resumption**: Support resuming loop steps after webhook responses
  - **Loop messages**: Track conversation history for context management within loops

- Updated dependencies
  - @positronic/core@0.0.38
  - @positronic/spec@0.0.38
  - @positronic/template-new-project@0.0.38

## 0.0.37

### Patch Changes

- Add WORKER_URL environment variable support for page URL construction.

  - Pages now use configurable origin URL via WORKER_URL env var instead of inferring from request URL
  - Enables proper URL generation when deployed behind proxies or custom domains
  - Falls back to request-based URL detection when WORKER_URL is not set

- Updated dependencies
  - @positronic/core@0.0.37
  - @positronic/spec@0.0.37
  - @positronic/template-new-project@0.0.37

## 0.0.36

### Patch Changes

- Fix Secrets interface to restore TypeScript autocomplete for project-specific secrets
- Updated dependencies
  - @positronic/core@0.0.36
  - @positronic/spec@0.0.36
  - @positronic/template-new-project@0.0.36

## 0.0.35

### Patch Changes

- Add runtime environment with origin and secrets access in brain steps

  - Add `env.origin` to provide the base URL of the running instance in brain steps
  - Add `env.secrets` to provide type-safe access to environment variables/secrets
  - Auto-generate `secrets.d.ts` from `.env` file for TypeScript autocomplete on secret names
  - Watch `.env` file for changes and regenerate types automatically
  - Clean up brain history CLI output by removing redundant error display section

- Updated dependencies
  - @positronic/core@0.0.35
  - @positronic/spec@0.0.35
  - @positronic/template-new-project@0.0.35

## 0.0.34

### Patch Changes

- - Remove step timeout functionality that was causing issues
  - Use STATUS constants instead of hardcoded strings across CLI and spec packages for better type safety and consistency
- Updated dependencies
  - @positronic/core@0.0.34
  - @positronic/spec@0.0.34
  - @positronic/template-new-project@0.0.34

## 0.0.33

### Patch Changes

- - Redesigned `px show` command: now shows detailed run information (including errors) instead of brain structure. Usage changed from `px show <filename>` to `px show <run-id>`
  - Fixed brain commands to work in production environments (not just local dev mode)
  - Added new API endpoint `/brains/runs/:runId/full` for retrieving complete run details
  - Improved error messages to distinguish between local dev server and remote project server connection issues
- Updated dependencies
  - @positronic/core@0.0.33
  - @positronic/spec@0.0.33
  - @positronic/template-new-project@0.0.33

## 0.0.32

### Patch Changes

- Fix Cloudflare secrets API and enable preview URLs

  - Fix secrets API to send secret name in body instead of URL path
  - Enable `workers_dev` and `preview_urls` in wrangler config for both dev and production environments

- Updated dependencies
  - @positronic/core@0.0.32
  - @positronic/spec@0.0.32
  - @positronic/template-new-project@0.0.32

## 0.0.31

### Patch Changes

- Fix Cloudflare secrets API endpoint - secret name now correctly passed in the request body instead of the URL path, fixing secret creation for deployed workers.
- Updated dependencies
  - @positronic/core@0.0.31
  - @positronic/spec@0.0.31
  - @positronic/template-new-project@0.0.31

## 0.0.30

### Patch Changes

- Implement secrets management feature

  - Add secrets API endpoints to Cloudflare backend for CRUD operations
  - Add `px secret list`, `px secret create`, `px secret delete`, and `px secret bulk` CLI commands
  - Use dotenv library to parse .env files for bulk secret uploads
  - Add comprehensive spec tests for secrets API
  - Update CLI components to use useApiPost/useApiGet hooks for server communication

- Updated dependencies
  - @positronic/core@0.0.30
  - @positronic/spec@0.0.30
  - @positronic/template-new-project@0.0.30

## 0.0.29

### Patch Changes

- - Fix bug where CLI commands in global mode incorrectly connected to localhost instead of the selected production project URL
  - Add 25-second step timeout to prevent brains from getting stuck in 'running' status when cloud platforms terminate long-running requests
  - Improve error messages to distinguish between local development server and remote project connection failures
- Updated dependencies
  - @positronic/core@0.0.29
  - @positronic/spec@0.0.29
  - @positronic/template-new-project@0.0.29

## 0.0.28

### Patch Changes

- Use the Cloudflare API directly for R2 bucket creation

  - Replace wrangler CLI commands with direct Cloudflare API calls for creating R2 buckets during deploy
  - Simplifies R2 bucket management by removing dependency on spawned wrangler processes
  - Provides better error handling with clearer error messages from the API

- Updated dependencies
  - @positronic/core@0.0.28
  - @positronic/spec@0.0.28
  - @positronic/template-new-project@0.0.28

## 0.0.27

### Patch Changes

- - Fix: Resources and pages are now properly separated in R2 storage - the resources API no longer throws errors when encountering page data or other non-resource objects without type metadata
  - Feature: Deploy command now automatically creates R2 bucket if it doesn't exist, eliminating the need for manual bucket setup before first deployment
  - Refactor: Simplified resource listing logic to use for-of loop instead of Promise.all with map
- Updated dependencies
  - @positronic/core@0.0.27
  - @positronic/spec@0.0.27
  - @positronic/template-new-project@0.0.27

## 0.0.26

### Patch Changes

- - Add automatic retry support for brain steps (1 retry on failure with STEP_RETRY event)
  - Support brain definitions in subdirectories (brain-name/index.ts) in addition to flat files (brain-name.ts)
  - Remove unnecessary console warnings when loading non-resource objects from R2 bucket
  - Fix TypeScript errors in cloudflare test-project
- Updated dependencies
  - @positronic/core@0.0.26
  - @positronic/spec@0.0.26
  - @positronic/template-new-project@0.0.26

## 0.0.25

### Patch Changes

- Make page slugs optional in PagesService

  - `pages.create(html, options?)` now auto-generates a unique slug when none is provided
  - Each brain run gets its own unique page when using auto-generated slugs
  - Explicit slugs (`pages.create(slug, html, options?)`) still work and will overwrite existing pages
  - Auto-generated slugs use format `page-{brainRunId-prefix}-{random}` for uniqueness
  - Added comprehensive tests for optional slug behavior

- Updated dependencies
  - @positronic/core@0.0.25
  - @positronic/spec@0.0.25
  - @positronic/template-new-project@0.0.25

## 0.0.24

### Patch Changes

- Add Cloudflare pages service implementation

  - Implement `createPagesService()` function for Cloudflare backend that provides CRUD operations for dynamic HTML pages stored in R2
  - Add pages service integration to brain-runner-do, allowing brains to create, read, update, and check page existence
  - Support persistent pages with optional TTL settings
  - Add comprehensive test suite for pages API endpoints and brain integration

- Updated dependencies
  - @positronic/core@0.0.24
  - @positronic/spec@0.0.24
  - @positronic/template-new-project@0.0.24

## 0.0.23

### Patch Changes

- Update Vercel AI SDK peer dependency to v5.0.0
- Updated dependencies
  - @positronic/core@0.0.23
  - @positronic/spec@0.0.23
  - @positronic/template-new-project@0.0.23

## 0.0.22

### Patch Changes

- Add pages feature for persistent UI components

  - New pages feature allows brains to create pages that can submit forms to webhooks or persist beyond a brain run
  - Pages can be managed via CLI commands (`px pages list`, `px pages delete`)
  - Core DSL extended with page creation and management capabilities
  - Cloudflare backend support for page storage and retrieval via Monitor Durable Object
  - Spec API tests for page endpoints

- Updated dependencies
  - @positronic/core@0.0.22
  - @positronic/spec@0.0.22
  - @positronic/template-new-project@0.0.22

## 0.0.21

### Patch Changes

- Add webhook verification support using discriminated union pattern.

  **Key Changes:**

  - Webhook handlers now return a discriminated union with `type: 'verification' | 'webhook'`
  - Simplifies URL verification for Slack, Stripe, GitHub, Discord and other webhook providers
  - Removes need for dummy values when returning verification challenges
  - Cleaner, more type-safe API with explicit intent for each return path
  - Updated webhook-design.md with comprehensive examples and future `start-brain` type

  **Breaking Change:**
  Webhook handlers must now return `{ type: 'webhook', identifier, response }` instead of `{ identifier, response }`. Verification responses use `{ type: 'verification', challenge }`.

- Updated dependencies
  - @positronic/core@0.0.21
  - @positronic/spec@0.0.21
  - @positronic/template-new-project@0.0.21

## 0.0.20

### Patch Changes

- Add webhook/waitFor functionality to enable brains to pause execution and wait for external events. This release includes:

  - **New waitFor API**: Brains can now pause and wait for webhook responses with type-safe schemas
  - **Webhook integration**: Full webhook support with identifier-based matching to resume paused brains
  - **Cloudflare backend support**: Complete implementation including webhook endpoints, brain pause/resume, and event monitoring
  - **Type inference**: Automatic TypeScript type inference for webhook responses in brain steps
  - **Comprehensive testing**: Added extensive test coverage for webhook flows and integration scenarios
  - **API specs**: New webhook-related spec tests for backend implementations

  Breaking changes: None

  Bug fixes:

  - Fixed TypeScript configuration to eliminate Cloudflare package errors
  - Fixed Claude.md prompt during .positronic directory regeneration
  - Fixed error handling to properly rethrow errors in webhook events

  Dependencies:

  - Added GitHub to WebFetch whitelist for documentation access

- Updated dependencies
  - @positronic/core@0.0.20
  - @positronic/spec@0.0.20
  - @positronic/template-new-project@0.0.20

## 0.0.19

### Patch Changes

- Add brain kill command to terminate running brain processes

  - New `px brain kill <run-id>` command with optional `--force` flag
  - Interactive confirmation prompt (bypass with --force)
  - Graceful handling of already completed or non-existent brain runs
  - Full test coverage across CLI, spec, and backend implementations
    EOF < /dev/null

- Updated dependencies
  - @positronic/core@0.0.19
  - @positronic/spec@0.0.19
  - @positronic/template-new-project@0.0.19

## 0.0.18

### Patch Changes

- Fix brain resolution to support titles different from filenames

  - Fixed critical bug where brain runs would fail when using brain titles that differ from their filenames
  - Changed brain runner to use manifest.resolve() instead of manifest.import() for proper identifier resolution
  - Added comprehensive tests for brain title vs filename resolution
  - Ensures the CLI's permissive identifier principle works correctly - users can use either brain titles or filenames
    EOF < /dev/null

- Updated dependencies
  - @positronic/core@0.0.18
  - @positronic/spec@0.0.18
  - @positronic/template-new-project@0.0.18

## 0.0.17

### Patch Changes

- Fix .positronic directory regeneration to use local template

  - Fixed issue where regenerating the `.positronic` folder after deletion would attempt to pull from npm instead of using the local template when `POSITRONIC_LOCAL_PATH` is set
  - Updated `generateProject` in cloudflare dev-server to match the behavior from CLI helpers
  - Now always resolves template location (from local path or installed package) and copies to temp directory before running caz
  - Ensures consistent behavior for both initial project generation and `.positronic` folder regeneration
    EOF < /dev/null

- Updated dependencies
  - @positronic/core@0.0.17
  - @positronic/spec@0.0.17
  - @positronic/template-new-project@0.0.17

## 0.0.16

### Patch Changes

- Refactor brain identification system

  - Removed ambiguous "brain name" concept - brains are now identified by title, filename, or partial matches
  - Added flexible BrainResolver that supports multiple identification methods while maintaining backward compatibility
  - Enhanced manifest structure to store rich metadata for better brain resolution
  - Updated all CLI commands to use consistent `filename` parameter (though any identifier works)
  - API now accepts generic `identifier` parameter with proper disambiguation when multiple matches found
  - Fixed test utilities to work with options and services

- Updated dependencies
  - @positronic/core@0.0.16
  - @positronic/spec@0.0.16
  - @positronic/template-new-project@0.0.16

## 0.0.15

### Patch Changes

- Add runtime options support for brain runs

  - Add ability to pass runtime options when creating brain runs via POST /brains/runs
  - Update Cloudflare implementation to support options parameter
  - Add spec tests for brain runs with options
  - Add example brain demonstrating runtime options usage

- Updated dependencies
  - @positronic/core@0.0.15
  - @positronic/spec@0.0.15
  - @positronic/template-new-project@0.0.15

## 0.0.14

### Patch Changes

- Fix cloudflare dev server to use default port 8787

  - Ensures wrangler dev server always uses port 8787 when no port is specified
  - Prevents CLI commands like `px list` and `px brain list` from hanging when connecting to the server
  - Aligns server port behavior with CLI expectations for better developer experience

- Updated dependencies
  - @positronic/core@0.0.14
  - @positronic/spec@0.0.14
  - @positronic/template-new-project@0.0.14

## 0.0.13

### Patch Changes

- ### Improvements

  - **CLI**: Fixed template resolution for CAZ to work correctly in non-local calls
  - **CLI**: Improved new project template handling to support both local development and installed package scenarios
  - **Build**: Updated release process to create a single version tag instead of individual package tags

  ### Internal

  - Added WebFetch permission for npmjs.com in local settings
  - Enhanced template path resolution using createRequire for better package location discovery
    EOF < /dev/null

- Updated dependencies
  - @positronic/core@0.0.13
  - @positronic/spec@0.0.13
  - @positronic/template-new-project@0.0.13

## 0.0.12

### Patch Changes

- Enhanced bump command to analyze changes and create meaningful changelog messages

  - Improved bump command workflow to include change analysis before version bumping
  - Now automatically reviews commits, file changes, and diffs since last release
  - Creates more informative changelog entries based on actual changes
    EOF < /dev/null

- Updated dependencies
  - @positronic/core@0.0.12
  - @positronic/spec@0.0.12
  - @positronic/template-new-project@0.0.12

## 0.0.11

### Patch Changes

- Bump all packages to next patch version
- Updated dependencies
  - @positronic/core@0.0.11
  - @positronic/spec@0.0.11
  - @positronic/template-new-project@0.0.11
