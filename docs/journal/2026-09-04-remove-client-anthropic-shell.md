# Remove @positronic/client-anthropic and @positronic/shell

**Status:** shipped
**Started:** 2026-09-04
**Shipped:** 2026-09-04
**Commit:** 5246e26

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

**Unpublish, not deprecate.** Both packages qualify for npm's post-72-hour
unpublish (under 300 weekly downloads, single maintainer, no dependents):
client-anthropic had 63 downloads/week, shell had 5. Sean chose unpublish.
The delete needs a 2FA one-time password, which npm prompts for
interactively, so it has to be run from a real terminal, not an agent shell.

**Merged fast-forward onto main.** The stale `dist/` and `node_modules/`
under the deleted package directories survive a merge because they were
never tracked; they had to be `rm -rf`'d by hand afterward. Jest went from
47.2% to 48.2% purely from dropping two 0% packages.
