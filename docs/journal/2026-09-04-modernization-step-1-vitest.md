# Modernization step 1: Jest to Vitest

**Status:** shipped
**Started:** 2026-09-04
**Shipped:** 2026-09-05
**Commit:** a7826308

## Goal

First step of `docs/modernization-plan.md`. Replace Jest 29 with Vitest 4 at the root so the repo runs one test runner (the cloudflare test-project was already on Vitest), drop the ESM workarounds Jest needed, and clear the way for removing SWC in step 3. The template that `px project new` scaffolds moves too.

## Log

### 2026-09-04 — migration

**What we did.** Root `jest.config.js` became `vitest.config.ts` with the same three projects. 51 test files had their imports and mock calls rewritten by script. The template project got the same treatment.

**Almost everything Jest needed, Vitest doesn't.** The experimental VM modules flag, the `.js`-to-`.ts` module name mapper, the robot3 dist mapper, the SWC transform, and the transformIgnorePatterns list for ink all went away with nothing replacing them. Vite resolves `./foo.js` to `./foo.ts` on its own and loads ESM-only packages natively. 590 of 604 tests passed on the very first run, in about six seconds.

**The one thing that broke was CommonJS default-import shape.** Under Node, `import caz from 'caz'` gives you the whole `module.exports` object, so the CLI calls `caz.default(...)` and that's what runs in production. Vitest's `deps.interopDefault` is on by default and flattens that to the inner function, so `caz.default` was undefined in every CLI test that scaffolds a project. Turning `interopDefault` off restores Node semantics. That's the right fix rather than changing the call sites, because the tests should see the same module shape production sees.

**vi.fn typing is stricter than jest.fn.** Two things the typecheck caught: `Mock<any>` is no longer callable because vitest 4's `Mock` generic wants a function type (bare `Mock` works), and `spyOn(...).mockImplementation()` needs an argument.

**Explicit imports, not globals.** 40 files already imported from `@jest/globals` and 10 relied on globals. Everything now imports from `vitest` explicitly and `globals` stays off. The script that did the rewrite had to compute which globals each file used; the first pass appended `vi` and `Mocked` to existing imports but missed `describe` and friends in files that had imported only `jest`, which showed up as a typecheck error and one file-level test failure. CLAUDE.md now says imports are explicit so nobody adds a globals-dependent test.

**Coverage numbers reconcile.** Vitest reports 143 files; Jest reported 160. The difference is exactly the 17 files in `packages/spec/src`, which the Jest config had left in by accident and the journal entry from the coverage setup flagged as noise. The percentages are not comparable (v8 vs Istanbul instrumentation), so don't read the jump from 48% to 63% as progress.

**npm 11 can't install vitest 4.1.** `npm install vitest@4.1.x` crashes arborist with `Cannot read properties of null (reading 'edgesOut')`. It's a peer-resolution bug in npm, not a lockfile problem: a fresh project with no lockfile fails the same way, vitest 4.0.0 installs fine, and the last npm 11 (11.19.1) still fails. npm 12 works, and it needs Node 24.15 or newer, so this session installed Node 24.20 through nvm, set it as the default, and put npm 12.0.2 on it. Both the root and a freshly scaffolded project install cleanly under it.

**npm 12 blocks install scripts by default.** Three packages in the tree have them: fsevents (native file watching, wanted), @swc/core (its postinstall just checks the native binding; gone in step 3 anyway), and dtrace-provider (an optional dep four levels under sshpk-agent whose `node-gyp rebuild` has never been needed). `npm install-scripts approve` writes an `allowScripts` block into package.json. The default writes pinned `pkg@version` keys that go stale on every bump; `--no-allow-scripts-pin` writes bare names. fsevents and @swc/core are approved, dtrace-provider is denied, and the install warning is gone. Note that `approve --dry-run` still wrote to package.json.

**The template's example test was already broken.** Scaffolding a project and running its test fails with "No more mock responses available". The test never calls `mockResponses` and asserts on state the example brain never produces. It was failing under Jest too; nothing verifies the template, which the plan doc already calls out. Left for a separate fix.

### 2026-09-05 — flaky CLI timeouts after the tooling swap

**What we did.** Moved the template scaffold into a Vitest `globalSetup` that runs caz once per run and hands the path to workers with `provide`/`inject`. Test files no longer scaffold anything.

**The suite went from three clean runs to 8-21 failures, all in the CLI project, all timeouts or their fallout.** Every CLI test file's first test was landing at 5.5s against a 5s limit. Chasing the cause went through the npm 12 re-hoist, the jest prune, Node 24.20, the rolldown native binding (present), and Vite transform times, none of which held up. Timing one caz scaffold alone answered it: about 3 seconds, because caz runs `npm install --production` in the template copy and then `git init`, `git add`, and `git commit` in the new project. Thirteen files doing that at once at startup was always borderline. What tipped it was load: a game and a couple of browsers had the machine at a load average near six, so the same suite that passed three times earlier in the evening started missing the limit. The global setup takes the scaffold off the per-file startup path entirely; two full runs under that same load passed.

**The old cache leaked.** The module-level template cache never deleted its directory, and Vitest isolates each file, so every file made a new one. The temp directory had 821 cached templates and 402 server-test dirs from tonight and before, about 3GB. Global setup's teardown deletes the one it makes. One `positronic-server-test-` dir per run still leaks from some test that doesn't reach its cleanup; left alone.

## Learnings

- Vitest's `deps.interopDefault` defaults to true and changes the shape of CommonJS default imports relative to Node. Any code that does `pkg.default(...)` on a CJS package will fail in tests until it's turned off.
- The `coverage.include` list in a Vitest config is the whole story for what gets reported. Jest needed a global `collectCoverageFrom` plus a per-project `coveragePathIgnorePatterns` with a negative-lookahead regex to express "cloudflare src except two files". Vitest just lists the two files.
- Check `npm --version` before assuming an install crash is about the repo.
- `globalSetup` runs in Vitest's own module runner, not a test worker, so `deps.interopDefault` does not apply there. A CommonJS package imported in global setup comes back flattened even when the workers see the Node shape. `createRequire` sidesteps the question.
- Before chasing a flaky suite through the dependency tree, check `uptime`. A load average near the core count explains a 10% timing miss on its own.

## Dead ends

- Pruning the stale `client-anthropic` and `shell` entries out of `package-lock.json` to fix the install crash. They were marked extraneous and looked like the cause. Removing them changed nothing; the crash was npm's peer resolver choking on vitest 4.1's peer set.

## Solution

Vitest 4 at the root with the same three-project split, explicit imports, CommonJS interop off, and the template scaffold moved into a once-per-run global setup. Jest's ESM workarounds and the SWC transform for tests are gone. npm 12 on Node 24.20 is the toolchain from here, with install-script approvals in package.json.
