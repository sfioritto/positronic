# Eliminate CLI Command Class Middlemen

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

The CLI had a 1:1:1 mapping: yargs handler in `cli.ts` -> command class method in `commands/*.ts` -> React component in `components/*.tsx`. The command classes were pure pass-throughs that destructured argv and called `React.createElement`. Every new command required touching 3 files. The goal was to collapse this to 2 touchpoints: yargs handler + component.

## Log

### Evaluation

Audited all 13 files in `commands/`. Found that 7 were pure pass-throughs (brain, schedule, secrets, pages, users, auth, store), 2 were near-pass-throughs with minor logic (project creates a `ProjectConfigManager`, resources has server-availability guards), and 4 had real logic that should stay (server, helpers, project-config-manager, backend).

The pattern likely originated from the new-command-creation-guide which prescribed a 3-phase approach. It's a classic MVC instinct — separating "routing" from "rendering" — but when the controller just forwards args, it's not separation of concerns, it's an extra hop.

### Execution

Rewrote `cli.ts` to import components directly and render them in yargs handlers. The interesting cases:

- **BrainResolver wrapping**: `history` and `schedule create` used `BrainResolver` as a render-prop wrapper. Inlined the `React.createElement(BrainResolver, { children: ... })` pattern directly in the handler.
- **show branching**: `brain show` had if/else logic (runId -> RunShow, brain -> BrainShow, else -> error). Inlined in handler.
- **users name->userName mapping**: Several user commands mapped `argv.name` to `userName` prop. Kept inline.
- **resources sync**: Had real logic (check server exists, create resources dir, scan files). Inlined with early-return pattern.
- **Shared ProjectConfigManager**: Both project and auth commands created separate `ProjectConfigManager` instances. Consolidated to one `configManager` created at the top of `buildCli`.

## Learnings

- No test file directly imported any command class — they all test through `buildCli()` -> yargs -> render. This made the refactor zero-test-change, which is the hallmark of removing dead indirection.
- The `project.ts` re-exported `ProjectConfigManager` and types, but grep confirmed nothing imported from `project.js` except `cli.ts`. The re-exports were dead code.
- `WatchResolver` lives in `watch-resolver.tsx`, not `brain-watch.tsx` — easy to get wrong from the component name.

## Solution

Deleted 9 command class files. All `React.createElement` calls now live directly in yargs handlers in `cli.ts`. Updated `docs/new-command-creation-guide.md` to document the 2-touchpoint pattern. 559 + 183 tests pass, build clean.
