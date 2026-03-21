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
- **`/packages/gen-ui-components`** - AI-generated UI component library for dynamic form generation
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

6. **Origin URL**: The origin URL (e.g., `https://myapp.workers.dev`) is stored in R2 at `__config/origin`, written at deploy time and dev server startup. To read it, use `getOrigin(bucket)` from `packages/cloudflare/src/origin.ts`. Never use environment variables for origin — R2 is the single source of truth.

### JSX Templates

Templates in `.prompt()`, `.page()`, `.map()`, and `.brain()` steps can return JSX (`TemplateNode`) in addition to strings. In `.brain()` steps, both `system` and `prompt` fields in `AgentConfig` accept `string | TemplateChild` (JSX). The runner resolves JSX to a string via `resolveTemplate()` before emitting events or passing to the LLM client.

- **JSX runtime**: `packages/core/src/jsx-runtime.ts` — exports `jsx`, `jsxs`, `Fragment` for the automatic JSX transform
- **Rendering**: `packages/core/src/template/render.ts` — `renderTemplate()`, `resolveTemplate()`, `isTemplateNode()`
- **Subpath export**: `@positronic/core/jsx-runtime` is exported from core's `package.json`
- **Monorepo caveat**: Do NOT use JSX syntax in core tests. The root `.swcrc` uses React as `importSource` (for CLI/Ink). Construct `TemplateNode` trees manually using `{ type: Fragment, props: {}, children: [...] }`.
- **Generated projects**: Use `jsxImportSource: "@positronic/core"` in their tsconfig
- **Whitespace preservation**: `.positronic/build-brains.mjs` in generated projects — esbuild plugin (inlined) that preserves JSX text whitespace. Runs via wrangler's `build.command`. Without it, the JSX compiler collapses newlines in text to spaces.

## Keeping the Project Template in Sync

The project template (`packages/template-new-project/template/.positronic/`) is what `px project new` uses to scaffold new projects. It has its own `wrangler.jsonc` and `src/index.ts` that are **separate from** the cloudflare test-project's versions. There are no tests that verify the template produces a working project, so you must keep it in sync manually.

**When adding a new Durable Object**, update all three places:

1. `packages/cloudflare/test-project/wrangler.jsonc` — migration + binding
2. `packages/cloudflare/test-project/src/index.ts` — import + export
3. `packages/template-new-project/template/.positronic/wrangler.jsonc` — migration + binding (both top-level AND the `env.production` section)
4. `packages/template-new-project/template/.positronic/src/index.ts` — import + export

**When adding a new API endpoint or binding**, check whether the template's `wrangler.jsonc` and `index.ts` need updates. The test-project and template must stay in sync — if one has it, the other should too.

**When adding a new brain event type** (`BRAIN_EVENTS` in `packages/core/src/dsl/constants.ts`), update all three places:

1. `packages/cli/src/components/events-view.tsx` — `formatEvent()` switch statement (list view symbol, text, color)
2. `packages/cli/src/components/event-detail.tsx` — `getEventSymbol()` (detail view symbol/color) AND `getEventDetailContent()` (detail view content)
3. `packages/core/src/dsl/definitions/events.ts` — TypeScript interface and add to the `BrainEvent` union type

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
- Do not include "Co-Authored-By" lines in git commit messages
- Consider adding small delays, e.g. awaiting a promise wrapping a setTimeout, when dealing with asynchronous code to be bad practice and a last resort.
- You tend to want to add things like `eslint-disable-next-line @typescript-eslint/no-explicit-any` to avoid type errors BUT you don't need to do this. Don't add eslint disable comments unless you see a linter error when running the lint command — which you won't because there's no linter.
- Don't add empty `.catch()` blocks or catch blocks that only log/comment. If you're not actually handling the error (recovering, retrying, showing UI), don't catch it. Don't ever catch and rethrow as well. That's ridiculous.
- Never use underscore-prefixed parameters (e.g. `_unused`) to indicate unused variables. If a parameter is unused, just leave it named normally — the underscore convention is ugly and unnecessary in this codebase.
- Prefer inferred return types. Don't add explicit return type annotations unless the method/function is complex and a return type would aid in future refactoring.
- Prefer destructuring at the top of methods/functions over `params.blah` access patterns.

### Testing

- testing philosophy: @docs/testing-philosophy.md
- CLI testing guide: @docs/cli-testing-guide.md
- Jest is the test framework
- **IMPORTANT**: Before creating or updating any tests, always read and load a few different test suites to follow the same patterns

## Developer Journal

- Always follow the developer journal skill (`.claude/skills/journal/SKILL.md`) when doing non-trivial work. This maintains a living record of development decisions, dead ends, and solutions in `docs/journal/`.

## Development Workflow

- Run `npm run dev` from the top of this mono repo every time you change a file and addresses errors and test failures as needed
- Run `npm run typecheck` to verify TypeScript types across the entire codebase

## Testing Memories

- **IMPORTANT**: If you run tests within test-project in the cloudflare package, those tests are run using vitest. Always add a --run option otherwise the test will never return and it will just wait for changes to files. Add --run otherwise you will never see the output of the tests.
