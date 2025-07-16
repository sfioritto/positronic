# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Positronic is an AI-powered framework for building and running "brains" - stateful AI workflows that can be deployed to various cloud backends. It provides a fluent DSL for defining AI workflows, resource management, and a CLI for development and deployment.

## Key Commands that you should care about

### Development

- `npm run dev` - Build all workspaces and run tests with notifications. RUN THIS OFTEN AS YOU MAKE CHANGES.
- `npm test` - Run all tests silently (including cloudflare tests)
- `npm run test:noisy` - Run tests with console output (shows console.error, console.log, etc.)
- `npm run test:all` - Run all tests including cloudflare tests (requires API keys)
- `npm run format` - Format code with Prettier.
- `npm run typecheck` - Run TypeScript type checking for all code, tests, and the cloudflare test-project

- **Important**: Run `npm run dev` frequently to ensure the build is working and tests are passing.

### Build and Clean

- `npm run build:workspaces` - Build all workspace packages
- `npm run clean:workspaces` - Clean all workspace build artifacts

### Running a Single Test

**Important**: Tests must be run from the monorepo root directory, not from individual packages.

- `npm test -- packages/path/to/test.spec.ts` - Run a specific test file
- `npm test -- watch.test.ts` - Run tests by filename (searches all packages)
- `npm test -- -t "test name"` - Run tests matching a pattern
- `npm run test:noisy -- watch.test.ts` - Run tests with console output (shows console.error, console.log, etc.)

## Architecture Overview

### Monorepo Structure

The project uses npm workspaces with the following packages:

- **`/packages/core`** - Core framework with Brain DSL, runner, resources, and JSON patch utilities
- **`/packages/cli`** - CLI tool (`px` or `positronic` commands) with commands for project, brain, resources, schedule, and server
- **`/packages/spec`** - Interface specifications, notably `PositronicDevServer` for backend implementations
- **`/packages/cloudflare`** - Cloudflare Workers backend with Durable Objects and R2 storage
- **`/packages/client-anthropic`** - Anthropic AI client integration
- **`/packages/client-vercel`** - Vercel client integration
- **`/packages/shell`** - Shell execution utilities
- **`/packages/template-new-project`** - Project scaffolding template

### Key Patterns

1. **Brain DSL**: Fluent API for defining AI workflows

   ```typescript
   brain('example')
     .step('Start', ({ state }) => ({ ...state, message: 'Hello' }))
     .step('Finish', ({ state }) => ({ ...state, done: true }));
   ```

2. **Backend Abstraction**: Backends implement `PositronicDevServer` interface, allowing multiple cloud provider implementations

3. **Resource System**: Manifest-based system for managing files and documents needed by AI brains

4. **State Management**: Uses JSON patches for efficient state updates and persistence

5. **Event-Driven**: Brains emit events (start, complete, error, step status) for monitoring

## Development Notes

### New Command Creation Guide

- @docs/new-command-creation-guide.md

### Type System

- TypeScript with strict mode enabled
- All packages use ESM modules
- Type definitions are auto-generated for resources in each project

### Coding Preferences

- Place all imports at the top of the file - avoid inline dynamic imports (`await import(...)`) except in rare cases
- Follow existing patterns in the codebase
- Consider adding small delays, e.g. awaiting a promise wrapping a setTimeout, when dealing with asynchronous code to be bad practice and a last resort.

### Testing

- testing philosophy: @docs/testing-philosophy.md
- CLI testing guide: @docs/cli-testing-guide.md
- Jest is the test framework
- **IMPORTANT**: Before creating or updating any tests, always read and load a few different test suites to follow the same patterns

## Development Workflow

- Run `npm run build:workspaces` and then `npm run test` from the top of this mono repo every time you change a file and addresses errors and test failures as needed
- Run `npm run typecheck` to verify TypeScript types across the entire codebase

## Testing Memories

- **IMPORTANT**: If you run tests within test-project in the cloudflare package, those tests are run using vitest. Always add a --run option otherwise the test will never return and it will just wait for changes to files. Add --run otherwise you will never see the output of the tests.
