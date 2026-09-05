# Remove @positronic/client-anthropic and @positronic/shell

**Status:** active
**Started:** 2026-09-04

## Goal

Drop two packages nothing uses. The coverage pass earlier today (see
`2026-09-04-test-coverage-setup.md`) put every source file in the report for
the first time, and `client-anthropic` and `shell` showed 0% with no
in-repo consumers: no package depends on them, no source imports them, and
`seans-bots` uses `@positronic/client-vercel` for models. Both are published
on npm (76 and 77 versions each, latest 0.0.79), so removal is two steps:
delete from the monorepo, then `npm deprecate` so nobody installs them.

## Log

### 2026-09-04 — removal

**What we did.** Deleted both packages, dropped them from the root
workspaces, tsconfig references, the changeset `linked` group, the bump
command template, and the CLAUDE.md package list. Rewrote the one doc example
in the project template that imported `createAnthropicClient`; it now uses
`VercelClient` with the `@ai-sdk/anthropic` adapter, matching the pattern the
template's own `runner.ts` documents.

**Why client-vercel won.** `client-anthropic` was a direct Anthropic SDK
wrapper. The Vercel AI SDK client covers Anthropic plus every other provider
through one interface, and it is what the template and seans-bots already
use. Keeping a second client meant a second code path for attachments, tool
results, and rate-limit headers with no one exercising it.

**gen-ui-components stays.** It looked like a removal candidate at 0% Jest
coverage, but it is load-bearing in seans-bots: `src/brain.ts` passes its
components into `createBrain`, `.positronic/bundle.ts` bundles them into the
browser bundle for generated pages, and core refuses to run a `.page()` step
without components configured. Nine page steps in seans-bots depend on it. The
0% is because the vitest suite is where pages get exercised, and vitest only
reports cloudflare source.

**Done in a git worktree.** The main checkout had uncommitted coverage
changes, and this belongs on its own branch. A worktree at
`../positronic-remove-pkgs` keeps the two efforts separate without stashing
or committing prematurely. Cost: a fresh `npm install` at the root and again
in `packages/cloudflare/test-project`, which has its own lockfile and
`node_modules`. The vitest run fails with exit 127 until that second install
happens.

**Left for after login.** The npm token in `~/.npmrc` returns 401, so the
`npm deprecate` step is pending an `npm login`.
