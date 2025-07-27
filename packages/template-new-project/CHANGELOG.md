# @positronic/template-new-project

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
