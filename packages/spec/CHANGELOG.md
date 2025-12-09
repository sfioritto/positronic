# @positronic/spec

## 0.0.24

### Patch Changes

- Add Cloudflare pages service implementation

  - Implement `createPagesService()` function for Cloudflare backend that provides CRUD operations for dynamic HTML pages stored in R2
  - Add pages service integration to brain-runner-do, allowing brains to create, read, update, and check page existence
  - Support persistent pages with optional TTL settings
  - Add comprehensive test suite for pages API endpoints and brain integration

## 0.0.23

### Patch Changes

- Update Vercel AI SDK peer dependency to v5.0.0

## 0.0.22

### Patch Changes

- Add pages feature for persistent UI components

  - New pages feature allows brains to create pages that can submit forms to webhooks or persist beyond a brain run
  - Pages can be managed via CLI commands (`px pages list`, `px pages delete`)
  - Core DSL extended with page creation and management capabilities
  - Cloudflare backend support for page storage and retrieval via Monitor Durable Object
  - Spec API tests for page endpoints

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

## 0.0.19

### Patch Changes

- Add brain kill command to terminate running brain processes

  - New `px brain kill <run-id>` command with optional `--force` flag
  - Interactive confirmation prompt (bypass with --force)
  - Graceful handling of already completed or non-existent brain runs
  - Full test coverage across CLI, spec, and backend implementations
    EOF < /dev/null

## 0.0.18

### Patch Changes

- Fix brain resolution to support titles different from filenames

  - Fixed critical bug where brain runs would fail when using brain titles that differ from their filenames
  - Changed brain runner to use manifest.resolve() instead of manifest.import() for proper identifier resolution
  - Added comprehensive tests for brain title vs filename resolution
  - Ensures the CLI's permissive identifier principle works correctly - users can use either brain titles or filenames
    EOF < /dev/null

## 0.0.17

### Patch Changes

- Fix .positronic directory regeneration to use local template

  - Fixed issue where regenerating the `.positronic` folder after deletion would attempt to pull from npm instead of using the local template when `POSITRONIC_LOCAL_PATH` is set
  - Updated `generateProject` in cloudflare dev-server to match the behavior from CLI helpers
  - Now always resolves template location (from local path or installed package) and copies to temp directory before running caz
  - Ensures consistent behavior for both initial project generation and `.positronic` folder regeneration
    EOF < /dev/null

## 0.0.16

### Patch Changes

- Refactor brain identification system

  - Removed ambiguous "brain name" concept - brains are now identified by title, filename, or partial matches
  - Added flexible BrainResolver that supports multiple identification methods while maintaining backward compatibility
  - Enhanced manifest structure to store rich metadata for better brain resolution
  - Updated all CLI commands to use consistent `filename` parameter (though any identifier works)
  - API now accepts generic `identifier` parameter with proper disambiguation when multiple matches found
  - Fixed test utilities to work with options and services

## 0.0.15

### Patch Changes

- Add runtime options support for brain runs

  - Add ability to pass runtime options when creating brain runs via POST /brains/runs
  - Update Cloudflare implementation to support options parameter
  - Add spec tests for brain runs with options
  - Add example brain demonstrating runtime options usage

## 0.0.14

### Patch Changes

- Fix cloudflare dev server to use default port 8787

  - Ensures wrangler dev server always uses port 8787 when no port is specified
  - Prevents CLI commands like `px list` and `px brain list` from hanging when connecting to the server
  - Aligns server port behavior with CLI expectations for better developer experience

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

## 0.0.12

### Patch Changes

- Enhanced bump command to analyze changes and create meaningful changelog messages

  - Improved bump command workflow to include change analysis before version bumping
  - Now automatically reviews commits, file changes, and diffs since last release
  - Creates more informative changelog entries based on actual changes
    EOF < /dev/null

## 0.0.11

### Patch Changes

- Bump all packages to next patch version
