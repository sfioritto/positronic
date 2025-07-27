# @positronic/client-anthropic

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

## 0.0.15

### Patch Changes

- Add runtime options support for brain runs

  - Add ability to pass runtime options when creating brain runs via POST /brains/runs
  - Update Cloudflare implementation to support options parameter
  - Add spec tests for brain runs with options
  - Add example brain demonstrating runtime options usage

- Updated dependencies
  - @positronic/core@0.0.15

## 0.0.14

### Patch Changes

- Fix cloudflare dev server to use default port 8787

  - Ensures wrangler dev server always uses port 8787 when no port is specified
  - Prevents CLI commands like `px list` and `px brain list` from hanging when connecting to the server
  - Aligns server port behavior with CLI expectations for better developer experience

- Updated dependencies
  - @positronic/core@0.0.14

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

## 0.0.12

### Patch Changes

- Enhanced bump command to analyze changes and create meaningful changelog messages

  - Improved bump command workflow to include change analysis before version bumping
  - Now automatically reviews commits, file changes, and diffs since last release
  - Creates more informative changelog entries based on actual changes
    EOF < /dev/null

- Updated dependencies
  - @positronic/core@0.0.12

## 0.0.11

### Patch Changes

- Bump all packages to next patch version
- Updated dependencies
  - @positronic/core@0.0.11
