# Test coverage across Jest and the cloudflare vitest project

**Status:** shipped
**Started:** 2026-09-04
**Shipped:** 2026-09-04

## Goal

Get an honest coverage number for the whole repo. `npm run test:coverage`
already existed but only reported files that some test happened to import,
and the cloudflare package (Durable Objects, API routes, files service, auth)
was invisible because those tests run under vitest in `test-project`, not
Jest.

## Log

### 2026-09-04 — first honest numbers

**What we did.** Set `collectCoverageFrom` in the root Jest config so every
`packages/*/src` file is reported, added Istanbul coverage to the cloudflare
`test-project` vitest config, and added `test:coverage` scripts for both plus
a root `test:coverage:all`.

**The old 67% was a lie by omission.** Jest with no `collectCoverageFrom`
only counts files that get loaded. Untested modules don't show as 0%, they
don't show at all. Once every source file is included, Jest's number dropped
from 67% to 47%. Whole packages (`client-anthropic`, `client-vercel`, `shell`,
`gen-ui-components`, `surface`) and core directories (`store`, `memory`,
`adapters`, `clients`) are at 0% under Jest. Some of those are exercised
indirectly by the vitest suite, but Jest can't see that.

**The workers pool can't do V8 coverage.** Cloudflare documents this in the
vitest-integration known issues: native V8 coverage isn't supported inside
workerd, so `@vitest/coverage-istanbul` is required. Version must match the
pinned vitest (3.0.9). With that in place the cloudflare src comes in at 76%
statements, 62% branches.

**Coverage `include` for files outside the project root has to be absolute.**
The test-project's tests import `../../src/*.ts` by relative path, and the
first attempt at `include: ['../src/**/*.ts']` silently matched nothing (an
"All files 0" table with no rows). Setting `allowExternal: true` flips
`test-exclude` into absolute-path mode, so the glob has to be absolute too.
The config now resolves `../src` off `import.meta.url` and interpolates it
into the glob. Passing `--coverage.include=` on the CLI to test this crashes
`test-exclude` with `pattern.replace is not a function`; edit the config file
instead.

**Jest's `collectCoverageFrom` is global, `coveragePathIgnorePatterns` is
per-project.** In a multi-project Jest config the first goes at the top level
and the second is ignored there. It took a full coverage run to notice the
cloudflare API files still showing up. It now lives in `sharedConfig`. A
negative glob in `collectCoverageFrom` couldn't do this job because micromatch
negations always win, so there was no way to say "exclude cloudflare/src
except `dev-server.ts` and `node-index.ts`". A regex with a negative lookahead
in `coveragePathIgnorePatterns` does it in one line.

**Split ownership of `packages/cloudflare/src`.** Worker-side code is
reported by vitest. The two Node-side entry points (`dev-server.ts`,
`node-index.ts`) are reported by Jest, since only the CLI tests exercise them.
Nothing is double-counted. Files vitest never loads (the same two, plus the
root `index.ts` and type-only `types.ts`) don't appear in the vitest report;
vitest's all-files scan doesn't reach outside the project root.

**Text reporter truncates long file names.** Comparing "files on disk" vs
"files in the report" by grepping the text table gave false negatives like
`brain-runner-do.ts` missing when it was really printed as `...runner-do.ts`.
Use `lcov.info` `SF:` lines for that comparison.

**Left alone.** `spec/src` shows 0% under Jest. It's the API contract test
package and is consumed by the vitest suite, so reporting it as untested
source is arguably noise. Worth excluding if it bothers anyone.

### 2026-09-04 — after removing client-anthropic and shell

Jest is at 48.2% statements across 160 files with the two dead packages
gone. Cloudflare vitest is unchanged at 76.3%. `client-vercel`,
`gen-ui-components`, and `spec` are the remaining 0% packages under Jest;
the first two are exercised at runtime by seans-bots and the vitest suite,
and `spec` is contract-test code, so none of the three is dead the way the
removed packages were.

### 2026-09-04 — spec package moved from Jest to vitest coverage

**What we did.** Excluded `packages/spec` from Jest's `collectCoverageFrom`
and added it to the vitest coverage include, with a `resolve.alias` so the
test-project loads spec from `src/index.ts` instead of the compiled dist.

**Why the alias.** The test-project depends on spec via `file:../../spec`,
and spec's package entry points at `dist/index.js`. Without the alias,
Istanbul instrumented the compiled JS and the include glob for
`spec/src/**/*.ts` matched nothing: an "All files" row with no spec entries.
Jest already does the equivalent through `moduleNameMapper`, so this is the
same idea on the vitest side.

**Spec is tests, not source.** It is ~5,600 lines of contract functions a
backend runs against its own fetch. Reporting it as untested source under
Jest was noise, and it was a quarter of the statement count: dropping it
moved Jest from 48% to 63% with no change in what is actually tested.

**The useful number is the inverse one.** In the vitest report, a spec
function at 0% is a contract no backend test enforces. 28 of 105 spec
functions never run. Whole groups are unwired: every `users.*` function, every
`pages.*` function, `bundle.get`, `auth.whoami`, both schedule timezone
functions, `signals.sendMessage`, `brains.search`, `brains.activeRuns`, both
`*Ambiguous` brain functions, and three `store.*` scoping checks. Cloudflare
implements most of these endpoints (its `api/users.ts` and `api/pages.ts` have
coverage from other tests), so the gap is the conformance link, not the
feature. `signals.sendMessageNoAgent` may be stale rather than missing: the
agent system it references was removed.

**Cost.** Including spec pulls the cloudflare vitest aggregate from 76% to
59%, because the spec files are now in the denominator. Read the per-file
rows, not the total.
