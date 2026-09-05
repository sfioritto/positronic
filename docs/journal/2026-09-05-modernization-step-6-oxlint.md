# Modernization step 6: oxlint

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commits:** 9a123311 (useConfirm split), 15412016 (phantom type parameters), 62592fec (oxlint and the sweep), e96e06f0 (oxfmt)

## Goal

Sixth step of the modernization plan. Add oxlint with a `lint` script, enforce unused parameters and unused test locals through its `no-unused-vars` (the part TypeScript's own flags could not do without underscore prefixes, see step 4), add `react/rules-of-hooks` for the CLI, and fix what the first run finds. The formatter question (Prettier 2.8 stays, Prettier 3.9, or oxfmt) is Sean's call and is recorded at the end.

## Log

### 2026-09-05 — one config file, 190 findings, most of them the unused-code sweep step 4 deferred

**What we did.** `oxlint@1.81.0` at the root, `.oxlintrc.json` with the default plugins plus `react`, `correctness` at error so the run fails, `no-unused-vars` with `args: after-used` and `ignoreRestSiblings` (`args: none` under `**/tests/**`, see the review pass), `react/rules-of-hooks` on. A `lint` script, and `npm run dev` runs it after the tests (it takes a fifth of a second; last so a stale import never hides test output). CLAUDE.md no longer says there is no linter.

**The react plugin is on everywhere.** The plan said to scope it to the CLI. Enabling it for the whole tree reports nothing outside `packages/cli` and `packages/gen-ui-components` (core's JSX tests use core's own runtime, and none of the react rules fire on them), so it needs no scoping. A rule from a plugin that is not enabled is silently ignored, which is why `plugins` lists `react` explicitly. Overrides add to the base plugins and rules; two are in use, both narrow.

**What the first run found.** 144 `no-unused-vars` (59 variables, 50 parameters, 14 catch bindings, 20 imports), 2 `rules-of-hooks` errors, 31 warnings from the react plugin's React Compiler rules, and a dozen small ones (`no-useless-escape`, `no-this-alias`, `no-useless-catch`, `no-new-array`, `prefer-as-const`, `no-constant-condition`). All but the Compiler rules are fixed; those five rules are off in the config with a comment, see Leftovers. `react/no-children-prop` is off for `cli.ts` alone, which passes render-prop children to `createElement` in a `.ts` file, and oxlint's version of the rule has no `allowFunctions` option.

**The two `rules-of-hooks` errors were real.** `useConfirm` picked one of two hook implementations by a `mode` option, so a component called a different hook depending on its props. The modes never change at runtime, so nothing broke, but the rule is right that it is a conditional hook call. It is now two exported hooks, `useYesNoConfirm` and `useTypeYesConfirm`, and the six callers name the one they want. The overload and the discriminated options type went away with it.

**Phantom type parameters.** `BrainBlock` carried five type parameters and `GuardBlock` two that nothing in their bodies referenced, so every `BrainBlock<A, B, C, D, E>` was the same type as every other. oxlint reports those the way TypeScript's `noUnusedParameters` would have. They are gone, and the nine reference sites in core read `BrainBlock` and `GuardBlock` now. `BrainBlock<TInnerBrain>` keeps its one real parameter.

**Draining a brain run in tests.** Eighteen core tests ran a brain to completion with `for await (const event of brain.run(...)) { /* drain */ }`. oxlint reports the unused loop variable and there is no way to write a `for await` without one. `await Array.fromAsync(brain.run(...))` is the built-in that does the same thing; Node 24 has it and TypeScript 7's `ESNext` lib types it, so no helper was needed.

**Type-only assertions in tests.** `const _count: number = state.count` and `const _typeAssert: TypeTest = true` exist only to make the compiler check a type. `state.count satisfies number;` as an expression statement does the same check with no binding, and oxlint's `no-unused-expressions` does not report a `satisfies` statement. Thirteen sites in `brain-types`, `guard`, `plugin`, and `type-inference-debug`.

**Unused parameters in tests are not enforced.** The first cut applied `args: after-used` to tests too. About forty sites were mocks whose trailing parameter exists to mirror an interface: `create: () => ({ log: (msg: string) => {} })` followed by `l.log('hello')` to prove the injected type came through. Dropping `msg` makes that call a type error, so the first cut annotated `create`'s return type instead, and rewrote two `vi.fn(async (query: string) => ...)` mocks as `vi.fn().mockResolvedValue(...)`, which types the injected method as `any` and stops the test checking what its name says it checks. The reviewer caught both. An override for `**/tests/**` now sets `args: none`; unused locals and imports stay errors there, which is what step 4 handed to this step.

**`generate-page-html.ts` escapes were dead.** The browser bootstrap is a template literal, and `\{` inside a template literal cooks to `{`, so the regex the browser has always received is `/^{{([^}]+)}}$/`, which is valid in non-unicode mode. The first cut doubled the backslashes so the browser would get `\{`; the reviewer pointed out that nothing executes the bootstrap in a test, so that was an unverified change to shipped page code. The backslashes are simply gone now and the emitted bytes are identical to before.

**Small removals that changed no behaviour.** `hasRootKey` on the `listExcludesRootKey` spec contract (its one caller in the cloudflare test-project dropped the argument); the `setMockToolResponse` setter in the test-project runner, which nothing called and whose variable nothing read; a `try { ... } catch (error) { throw error }` in the test dev server; `const self = this` aliases in `brain.ts` and the test dev server where the closures were already arrows or could be; `if (true) { throw }` in an error test replaced by an explicit return type on the throwing step; `new Array(n).fill(null)` became `Array.from({ length: n }, () => null)`.

### 2026-09-05 — oxfmt replaces Prettier

Sean chose oxfmt over Prettier 3.9 to stay in the oxc toolchain. `oxfmt --migrate=prettier` read the `prettier` key in the root package.json and `.prettierignore` and wrote `.oxfmtrc.json`; the one thing it had to decide was `printWidth`, which Prettier defaulted to 80 and oxfmt to 100, and it kept 80. The `format` script and the PostToolUse hook now call `oxfmt`; the `prettier` key and `.prettierignore` are gone. The 2.8.8 Prettier that was formatting this repo was never a declared dependency, only the copy `@changesets/cli` pulls in.

The reformat touched 33 code files, all Prettier 3 style: a trailing comma after the last type parameter, nested ternaries indented one level deeper, and trailing commas in `wrangler.jsonc` (Wrangler parses JSONC leniently; the cloudflare suite ran against the reformatted file). An earlier measurement of 261 files was with oxfmt's default printWidth of 100, which is why the migrated config matters.

Markdown is excluded. oxfmt 0.66 turned `**Naming: Template*, not Prompt*.**` in `ideas.md` into `_*Naming: Template*, not Prompt_.**`, which is not the same document, and it also reflows code fences differently from Prettier (`tools: { /* ... */ }` collapsed onto one line, multi-line union types joined). It would also have stripped the blank lines changesets writes into every CHANGELOG, so each release would re-dirty five files. `**/*.md` is in `ignorePatterns` with a comment saying why; revisit when oxfmt's Markdown support settles.

## Learnings

- oxlint ignores a rule whose plugin is not in `plugins`, without a warning. `react/rules-of-hooks` in `rules` alone does nothing.
- `react/no-children-prop` in oxlint takes no options; ESLint's `allowFunctions` is not there. The rule is off for `cli.ts` only.
- The react plugin ships the React Compiler rules (`set-state-in-effect`, `refs`, `purity`, `immutability`, `exhaustive-deps`) in `correctness`. They are a body of work, not a lint fix.
- `Array.fromAsync` is the idiomatic way to drain an async iterable when the loop body is empty.
- `x satisfies T;` as a statement is a binding-free type assertion that no enabled rule reports.
- `vi.fn()` with no implementation is `Mock<(...args: any[]) => any>`. Using it where a typed mock was is a silent loss of type coverage in the code the mock is injected into.
- zsh does not word-split `$VAR`; `git checkout -- $FILES` with a newline-separated list is one bad pathspec. Pipe through `xargs`.
- `git diff` in this checkout runs difftastic; use `git --no-pager diff --no-ext-diff` for a unified diff a script or reviewer can read.
- Prettier was never a declared dependency of this repo. The `prettier` binary `npx` found was the 2.8.8 that `@changesets/cli` pulls in.
- `oxfmt --migrate=prettier` reads the package.json `prettier` key and `.prettierignore`. Its Markdown formatter (0.66) has an emphasis bug; keep `**/*.md` ignored until that is fixed.

## Dead ends

- Scoping the react plugin with an `overrides` block. Works, but the flat config reports the same findings and is shorter.
- `react/no-children-prop` with `allowFunctions`. Not an option in oxlint.
- `args: after-used` in tests. Forty mechanical edits and two mocks that lost their types. Reverted after review.

## Leftovers

- The React Compiler rules are off with 31 sites in the CLI: 15 `set-state-in-effect`, 12 `exhaustive-deps`, 2 `refs` (`watch-machine.ts`, `store-explorer.tsx`), 1 `purity` (`Date.now()` in `schedule-list.tsx`), 1 `immutability` (`resource-upload.tsx` calls `performUpload` before its declaration inside an effect). Turn each rule on when its sites are fixed; `exhaustive-deps` needs care since adding `execute` to a dependency array re-fires API calls.
- `docs/new-command-creation-guide.md` still shows `import React from 'react'` in its component example, which `noUnusedLocals` now rejects in the CLI.
- `listExcludesRootKey` in `@positronic/spec` lost its dead `hasRootKey` parameter. The only caller is the cloudflare test-project. No changeset was written; the packages are linked at 0.0.x and none of the earlier steps wrote one.
- The spec contracts `rootFetch` parameters that step 4 listed did not show up: they precede a used parameter, so `after-used` exempts them.

## Review loop

### 2026-09-05 — pass 1

Taken: `args: none` for `**/tests/**` (the reviewer's point that step 4 had already kept unused-code enforcement out of tests, and that the parameter sweep was where the two regressions came from); the two `vi.fn().mockResolvedValue` mocks and the invented `LoggerApi` interface reverted with it; the page-bootstrap escapes deleted rather than doubled so the shipped bytes do not change; `react/no-children-prop` off for `cli.ts` only instead of tree-wide; `Array.from({ length })` instead of mapping the source rows to nulls. Declined: converting `type-inference-debug.ts` to `expectTypeOf` under `--typecheck` (a separate piece of work, already in step 4's leftovers); a changeset for the spec parameter (recorded above instead); keeping the `useConfirm` name for the type-yes variant to save four file touches (two hooks with parallel names read better). The reviewer also said the two docs guides reference `useConfirm`; they do not.

Also taken: the reviewer's suggestion to land this as three commits, the hook split, the phantom type parameters, and the oxlint adoption with its sweep, so each is reviewable on its own and each tree passes `npm run dev`.

### 2026-09-05 — pass 2

Taken: lint moved to the end of `npm run dev` so a lint error never hides the test results; and the binding-validation test in `generate-page.test.ts`, which the sweep had left with no assertion at all, now asserts that the valid template has no `invalid-binding` error and the invalid one has exactly one. Declined: widening the test override to `**/test-project/**` and restoring the parameter type on the test-project's `generateObject` mock (the `ObjectGenerator` annotation on the const already enforces the contract; the inline type duplicated it, and the stricter rule is what found the dead `setMockToolResponse` export); the React Compiler rules at `warn` instead of `off` (31 warnings on every run are noise nobody reads; they come on per rule as their sites are fixed); a `lint:fix` script on `--fix-dangerously` (the flag does remove unused imports and catch bindings, worth knowing for the next sweep, but not something to hand out as a script); deleting `type-inference-debug.ts` (it is typechecked by core's tests tsconfig, so it does run in the sense that matters); assertions on `createdAt` in the pages test and on the zip `FileRef` (the first has nothing to assert, see step 4; the second is not what that test is about); a `toContain` on the bootstrap regex source. The loop stops here: pass 2 mostly re-argued pass 1's settled points.

## Solution

oxlint 1.81 with one config file: default plugins plus react, `correctness` at error, `no-unused-vars` with `args: after-used` in source and `args: none` in tests, `react/rules-of-hooks`, the React Compiler rules off with their 31 sites recorded above. `npm run lint`, also the last step of `npm run dev`. The sweep fixed 190 findings; the two that were real bugs in waiting were a conditional hook call in `useConfirm` (now two hooks) and phantom type parameters on `BrainBlock` and `GuardBlock` (gone). The formatter is oxfmt with the migrated Prettier settings, Markdown excluded.
