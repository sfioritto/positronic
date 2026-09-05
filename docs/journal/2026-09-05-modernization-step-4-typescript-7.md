# Modernization step 4: TypeScript 7 and the strictness flags

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commits:** 42ba3883 (React import sweep), 05565b70 (template tsconfig include), a17247db (TypeScript 7 and flags)

## Goal

Fourth step of the modernization plan. Move the repo to TypeScript 7.0.2 (the Go compiler) and adopt the flags Monocles runs with: `verbatimModuleSyntax`, `erasableSyntaxOnly`, `moduleDetection: force`, `noUnusedLocals`, `noUnusedParameters`. The build is tsc-only since step 3, so the compiler is now the only thing that turns source into `dist`; making it stricter and faster is the payoff of that step.

## Log

### 2026-09-05 — TS 7 just works; the flags are where the work is

**What we did.** `typescript@7.0.2` at the root, the test-project, and the template. `verbatimModuleSyntax` and `moduleDetection: force` in the root tsconfig; `noUnusedLocals` in each package's own tsconfig so it covers source and not tests. The `import React` line dropped from 42 CLI components, and a dozen dead imports and locals removed from package source.

**TS 7 needed nothing from the build.** The plan said to confirm `composite` references and declaration emit before touching anything else. A clean rebuild under 7.0.2 produced the same flat `dist/` with `.d.ts` and maps, and the root `tsc --noEmit` still substitutes referenced projects' declarations. The only new diagnostic was in the CLI's resource uploader: `new Blob([buffer])` no longer typechecks because the current lib.dom says a `BlobPart` must be backed by a plain `ArrayBuffer`, and a Node `Buffer` is typed over `ArrayBufferLike` (it may sit on a `SharedArrayBuffer`). Copying into a `Uint8Array` is the honest fix; the copy is a few kilobytes per resource.

**The React imports were dead since step 3.** With `jsx: react-jsx` the transform imports the runtime itself, so `import React from 'react'` at the top of every Ink component was an unused binding that `noUnusedLocals` immediately reported. Files that name `React` explicitly were not flagged, so the flag did the audit for us. This landed as its own mechanical commit.

**The spec package's own `typescript` pin was removed, not bumped.** The plan said to bump every package that pins its own. Every other workspace package already relies on the root install, so the pin was the odd one out and the hoist covers it. The test-project and the template are separate installs and keep a pin.

**The template's tsconfig never had any inputs.** Its `include` listed `brains/**`, but the template has shipped `src/brains/` for a long time, so a scaffolded project's `tsc --noEmit` failed with "No inputs were found" before this step. It now includes `src` and `tests`, verified by scaffolding a project against the checkout and running tsc in it. That is a product bug fix, so it is its own commit. The template's `.positronic/tsconfig.json` used `moduleResolution: node`, which TypeScript 7 no longer accepts; it is `bundler` now, which is what the cloudflare test-project already used.

### 2026-09-05 — the first cut had all five flags; two came back out

The first pass turned on `erasableSyntaxOnly` and put `noUnusedLocals` at the root, where it governs every test directory. That meant 19 constructors rewritten from parameter properties to explicit fields (the plan had counted 11; eight more spread their parameter properties across lines), about a hundred edits in test files, and three constructors that needed local type aliases so an inline type was not written twice. `noUnusedParameters` never went on: it reports the `uri` parameter in eight nock reply callbacks in `packages/cli/tests/test-dev-server.ts`, where `uri` comes before the `requestBody` the handler reads. TypeScript's only exemption is an underscore prefix, which CLAUDE.md forbids.

Both review passes led with the same two points. `erasableSyntaxOnly` exists so a type-stripping runtime (Node's `--experimental-strip-types`, Bun, Deno) can run `.ts` files directly; nothing here does that (tsc emits, Vite and esbuild strip), so the flag was a permanent three-lines-per-dependency tax on every class for no runtime benefit. And `noUnusedLocals` in tests costs the most and pays the least: it deletes the `instance` binding the CLI testing guide tells you to reach for when debugging a render, and every future test that adds it back fails typecheck. Sean took both points. The flag is gone and the constructors are back to parameter properties (the three type aliases stayed; they read better than the inline blobs). `noUnusedLocals` lives in each package's tsconfig, which includes only `src`, and `packages/core/tests/tsconfig.json` turns it off explicitly since it extends core's. That also settled the template: it gets `verbatimModuleSyntax` and `moduleDetection` only, since the other two are house style rather than framework requirements and they would have governed end users' brains.

The plan for `noUnusedParameters` is oxlint in step 6. Its `no-unused-vars` rule has `args: after-used`, which is exactly the exemption TypeScript lacks, so the nock callbacks need no renames.

## Learnings

- TypeScript 7.0.2 builds this repo's composite references and declaration output without changes. The migration cost was entirely in the flags, not the compiler.
- `noUnusedParameters` and a no-underscore rule cannot both hold for a callback whose unused parameter precedes a used one. The flag exempts only the underscore, and TypeScript has no equivalent of ESLint's `args: after-used`. oxlint has it.
- `noUnusedParameters`, not `noUnusedLocals`, is the flag that reports unused type parameters. Phantom type parameters on exported types (`BrainBlock`, `GuardBlock`) are safe under `noUnusedLocals` alone.
- The root tsconfig has `references` but no `files` or `include`, so a root flag governs every test directory in one program while package source is substituted by its declarations. Per-program strictness means putting the flag in the package tsconfigs, which is where `noUnusedLocals` now is. The root `tsc --noEmit` therefore does not check package source for unused locals; the per-package build does.
- Recent lib.dom types `BlobPart` over `ArrayBuffer` only, so a Node `Buffer` needs a copy before it goes into a `Blob`. A `Uint8Array` view over `buffer.buffer` is still typed over `ArrayBufferLike` and fails the same check.
- With the automatic JSX runtime, `import React` is dead unless the file names `React` explicitly. `noUnusedLocals` is the cheapest way to find which files still do.
- `expr satisfies T;` as a statement is the unused-binding-free way to write an inference assertion in a type test file. Not needed once tests were out of the flag's reach, but worth knowing for `type-inference-debug.ts`.

## Dead ends

- All five flags at the root. Nineteen constructor rewrites and a hundred test edits for two flags that changed no runtime behaviour. Reverted after review.
- Hunting for a non-underscore escape hatch for the nock callbacks under `noUnusedParameters`. A rest-parameter wrapper or a helper that indexes `args[1]` satisfies the compiler and reads worse than the underscore it avoids. The answer is a different tool, not a different spelling.

## Review loop

Two passes. Pass 1 led with dropping `erasableSyntaxOnly` and keeping unused-code enforcement out of tests and the template; pass 2 repeated both, so the loop stopped. Taken, after Sean's call: both of those. Also taken: a comment on the `Uint8Array` copy in the resource uploader, and `tests/**` in the template's include (the smoke project passes with it). Declined: asserting on `createdAt` in the page-overwrite test (the route stamps a new timestamp on every POST, so there is nothing to assert); `fs.openAsBlob` to avoid the copy (still experimental in Node's docs); making `.positronic/tsconfig.json` extend the template's (they share almost no settings); a test that scaffolds and runs tsc (needs an `npm install` per run).

## Leftovers

- `noUnusedParameters` stays off in tsconfig. Step 6 enforces it through oxlint with `args: after-used`. The parameters the tsconfig flag found and oxlint will find again: `zip-builder.ts` (`final`), `brain-runner-do.ts` (`cancel: (reason)`), `resources.ts` (`ownKeys: (target)`), `test-dev-server.ts` (`kill(signal)`, `waitUntilReady(maxWaitMs)`), mock implementations in `helpers.test.ts` and `packages/mem0/tests/helpers.test.ts`, and unused `rootFetch` and `hasRootKey` parameters on four spec contracts.
- Unused locals in tests are also step 6's job now. The tsconfig flag found: unused `instance` bindings in six CLI test files, dead imports in `schedule.test.ts` and `packages/mem0/tests/test-helpers.ts`, never-read fields on `MockServerHandle`, and a handful in the cloudflare test-project's tests and `src/runner.ts`.
- The root tsconfig could become a solution file (`files: []`) with a tsconfig per test directory, as core's tests already have. Then each program picks its own strictness instead of inheriting the root's.
- `packages/cloudflare/src/api/store.ts` imported `requireRoot` and never used it; the routes check `isRoot` by hand at eight sites. The import is gone. Worth confirming per-route checks are deliberate there.
- A test that scaffolds the template and runs `tsc --noEmit` would have caught the `brains/**` include years ago. It needs the scaffolded project installed, so it is a minute per run.
- `packages/core/tests/type-inference-debug.ts` is never run. Vitest 4's `expectTypeOf` with `--typecheck` would make an inference regression fail a test run.
- The template's `.positronic/tsconfig.json` cannot typecheck on its own: its `@cloudflare/workers-types` devDependency is never installed because nothing runs `npm install` in that directory. Pre-existing, and nothing runs tsc there.
- `@types/node` is still 20 at the root and in spec, 22 in cloudflare. Vite 8 wants `^20.19 || >=22.12`. That is step 7.

## Solution

TypeScript 7.0.2 everywhere, `verbatimModuleSyntax` and `moduleDetection: force` at the root, `noUnusedLocals` per package on source only. Classes keep parameter properties. Unused parameters and unused locals in tests wait for oxlint, whose `after-used` option fits the no-underscore rule.
