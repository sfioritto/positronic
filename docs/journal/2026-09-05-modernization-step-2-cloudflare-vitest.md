# Modernization step 2: Cloudflare test-project to Vitest 4

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 5d8f7384

## Goal

Second step of `docs/modernization-plan.md`. The cloudflare test-project was pinned to Vitest 3.0.9 through `@cloudflare/vitest-pool-workers` 0.12, while the root moved to Vitest 4 in step 1. One Vitest across the repo, and a current wrangler.

## Log

### 2026-09-05 — the pool became a plugin, and isolation became per file

**What we did.** `@cloudflare/vitest-pool-workers` 0.12 is now `@cloudflare/vitest-plugin` 1.1, Vitest is 4.1.11, wrangler 4.129. The config is a `cloudflareTest()` Vite plugin instead of `defineWorkersConfig`. Eleven tests got per-test cleanup, the Secrets spec tests stub global fetch instead of using the removed `fetchMock`, and `env` comes from `cloudflare:workers`.

**The package was renamed under us.** The plan said 0.22. Installing it worked, but the Cloudflare docs now say v1 ships as `@cloudflare/vitest-plugin` with the same API, so that is what landed. Same config shape, one fewer rename later.

**Storage isolation is per test file now, not per test.** This was the whole cost of the step. Under 0.12 every test started with empty R2 and empty Durable Objects. Under the plugin a file shares storage across its tests, matching Vitest's own model. Nine tests broke, all the same way: a count that assumed nothing came before it. Three kinds of fix:

- R2-backed tests (files, resources) clear the bucket in `beforeEach`. resources-api already had the cleanup code in `beforeAll`; it moved.
- The schedules tests delete every schedule through the API in `beforeEach`, since ScheduleDO keeps them.
- The watch-history test counts only the runs it created, by id. Run history for `basic-brain` is shared with every other test in the file that ran it.

Per-test isolation is not coming back. The migration guide's only alternative is `--max-workers=1 --no-isolate`, which shares storage across _all_ files, the opposite direction.

**A fire-and-forget test was poisoning the next one.** api-error has a test that starts a brain configured to throw, checks that history says "running" without waiting, and ends. Under 0.12 isolation tore that run down with the test. Now it keeps going into the next test, which sets its own mock error on the module-level mock client. The leftover run consumed it, and the next test's brain ran clean and failed on an unknown tool instead. The test now drains its run by watching the SSE stream to completion before returning. The sibling test that starts `basic-brain` doesn't need draining, since that brain never calls the client.

**`fetchMock` is gone.** The Secrets spec tests used undici's `fetchMock` from `cloudflare:test` with one intercept per test. The secrets routes call the Cloudflare API through the global `fetch`, so `vi.stubGlobal('fetch', ...)` with a twenty-line in-memory secrets endpoint replaces all of it. The tests got shorter: each one sets `mockSecrets` and calls the spec function.

**`env as TestEnv` casts started failing typecheck.** `env` from `cloudflare:workers` is typed as the generated `Env`. The old `cloudflare:test` `env` was loosely typed, so the local `TestEnv` interfaces never had to match. They declared a `DB: D1Database` binding that has never existed in wrangler.jsonc, and that one phantom property made the types non-overlapping. Deleting it from eleven files fixed every error.

**Coverage crashes on external uncovered files.** `Unknown Error: undefined` at the end of a coverage run, after all tests passed. `DEBUG=vitest:coverage` showed it dying on "Uncovered file 0/57". Vitest instruments every file in `coverage.include` that no test loaded, and under the workers plugin that transform fails for any file outside the project root, even `content-type.ts` which imports nothing from Cloudflare. The old config used absolute `include` globs for `../src`, so every unloaded file went down that path. The new config uses a root-relative `**/*.ts` glob for discovery (which only finds this project's own fixtures, excluded by absolute path) and keeps `allowExternal` so external files are reported once a test loads them. `src/index.ts` pulls in nearly everything, so the report has 37 cloudflare files and 14 spec files. Files nothing imports no longer show as 0%; they don't show at all. Same caveat the coverage journal already recorded for four files, now slightly wider.

**The test-project needed `"type": "module"`.** Vite bundles `vitest.config.ts` as CommonJS when the nearest package.json has no type field, and the plugin is ESM only. The rest of the repo is ESM already.

**npm 12 blocks workerd's install script.** That script is what puts the platform binary in place, so tests can't start without it. `allowScripts` in the test-project approves workerd, esbuild, and fsevents. The template gets the same block plus an `engines` field, so a scaffolded project says up front that it wants Node 24.15 and npm 12.

**`npm run dev` in the test-project is `wrangler dev`.** Ran it there by accident and it sat for ten minutes. The gate is the root script.

### 2026-09-05 — review loop: `reset()` looked like the answer and wasn't, and a real bug under the errors

**What we did.** Ran the fresh-context review loop. Kept the coverage simplification and the `TestEnv` aliases, reverted the reviewer's `reset()` suggestion, and fixed a catch-and-rethrow in the runner DO that the new plugin exposed.

**The reviewer found `reset()` in `cloudflare:test`, and I rejected it for the wrong reason before accepting it.** The v1 types document `reset()` as "deletes all data from all attached bindings," with an `afterEach` example. The first attempt at adopting it coincided with five unhandled rejections per run and one run that hung for eight minutes, and I read that as `reset()` wiping other files' Durable Objects mid-run. It wasn't. The rejections were a separate bug (next paragraph), the hang was two agents running the suite at once, and once the bug was fixed `reset()` in `beforeEach` passed three clean runs at eleven seconds each. It replaced the schedule-deleting `beforeEach`, both bucket-clearing loops, the run-id filtering in the watch test, and the `drainRun` helper: about sixty lines of workaround for six lines of `reset()`.

**The five unhandled rejections outlived the first revert, and my grep had been hiding them.** For the last dozen runs the summary grep matched the "Tests" line and nothing else, so "Errors 5 errors" and the exit code 1 never showed. `npm test` in the test-project had been failing since the plugin switch. The cause is in `brain-runner-do.ts`: the fire-and-forget `runner.run(...)` has a `.catch` that logs and rethrows, so every brain that errors becomes an unhandled rejection. Under pool 0.12 those got swallowed by per-test teardown. The plugin reports them. The `.catch` now only logs; the runner already emitted the ERROR event, and nobody awaits that promise. Same for the `wakeUp` path.

**Two reviewer suggestions declined.** Removing `coverage.include` entirely: tried twice, see dead ends. The glob stays, with the comment saying why. Reporting the never-loaded cloudflare files from the root Vitest config instead: they would appear at 0% under a runner that cannot execute them, which reads as untested rather than unreported. Filed as a known caveat instead.

**The `engines` floor was too strict.** The template now says `npm >=12` only. npm 12 runs on Node 22.22 too, so a Node 24.15 floor would have been the installer's constraint dressed up as the project's.

## Learnings

- Under `@cloudflare/vitest-plugin`, storage isolation is per test file. A test that asserts on a count must either clean up first or scope the count to what it created.
- Module-level mock state plus fire-and-forget runs is a trap once storage stops resetting between tests. Drain the run or the next test inherits it.
- Vitest 4 coverage transforms unloaded files for reporting. Under the workers plugin, keep `coverage.include` root-relative and let external files arrive through `allowExternal` as tests load them.
- The `cloudflare:test` `env` was loosely typed. `cloudflare:workers` `env` is the real generated `Env`, and stale local interfaces surface immediately. `type TestEnv = Cloudflare.Env` cannot drift.
- `reset()` from `cloudflare:test` restores per-test isolation in one line per file. Reach for it before writing cleanup code.
- When a change and a failure show up together, check whether the failure exists without the change before blaming it. The `reset()` verdict was wrong for an hour because I didn't.
- When grepping a test summary, match the "Errors" line and check the exit code. A suite can pass every test and still fail the run.
- A `.catch` that rethrows on a promise nobody awaits is an unhandled rejection with a log line in front of it.

## Dead ends

- Coverage with no `include` at all, as the second review suggested. With `allowExternal` and no glob, nothing external was reported (0 files); with agent-written absolute excludes and no glob, compiled `.js` from `core/dist` came along (83 files). The root-relative `**/*.ts` glob is what makes the external `.ts` files show up and nothing else.

- Rooting Vitest at the cloudflare package (`root: '..'`) so `src` is internal to coverage. The plugin then resolved Vitest from the monorepo root's node_modules and workerd could not find the coverage-istanbul chunk in that copy. Two Vitest installs in play is worse than the coverage caveat.
- Absolute-path `coverage.include` with `exclude` trimmed, or with the lcov reporter dropped. Every variant that listed an unloaded external file crashed the same way.

## Solution

@cloudflare/vitest-plugin 1.1 on Vitest 4.1 with wrangler 4.129. `reset()` in `beforeEach` where tests need a fresh slate, a global-fetch stub for the Secrets spec tests, `env` from `cloudflare:workers` with the local `TestEnv` interfaces deleted, and a root-relative coverage glob. The DO's catch-and-rethrow was exposed by the plugin and is now log-only, with the proper fix (runner resolves after emitting ERROR) left for its own change.
