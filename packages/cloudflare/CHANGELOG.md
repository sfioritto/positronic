# @positronic/cloudflare

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
