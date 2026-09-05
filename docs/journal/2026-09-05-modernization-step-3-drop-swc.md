# Modernization step 3: drop SWC and let tsc emit

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commits:** c68564d6 (drop SWC, flat dist, backend loader), 3e54fad4 (JSX in core tests)

## Goal

Third step of the modernization plan. Every package ran `tsc` for declarations and then `swc src -d dist` for JavaScript: two compilers, two output trees (`dist/src` and `dist/types`), and a root `.swcrc` that forced React as the JSX import source on the whole repo. One compiler, one output tree, and each package owning its own JSX settings.

## Log

### 2026-09-05 — tsc emits, the layout flattens, and the CLI had the old layout memorised

**What we did.** Each package tsconfig swaps `emitDeclarationOnly` and `declarationDir` for `outDir: ./dist`. The build script is `tsc --project tsconfig.json`. `@swc/cli`, `@swc/core`, `@swc/plugin-transform-imports` (which nothing referenced), `.swcrc`, the `.swc` cache directories, the `.gitignore` line, and the `allowScripts` entry are gone. The output layout is now flat: `dist/index.js` beside `dist/index.d.ts`, the shape spec and template-new-project already had. Six package.json files changed their `main`, `types`, `exports`, or `bin`, and the CLI `postbuild` chmods `dist/positronic.js`.

**The CLI knew the old layout by heart.** `packages/cli/src/commands/backend.ts` assembled `dist/src/node-index.js` from path segments for both the `file:` and npm backend cases. A grep for `dist/src` never sees a path built from `'dist', 'src', 'node-index.js'`. No test caught it either: the CLI suites talk to a nock server and never load the real backend. It surfaced only when scaffolding a project against the local checkout and starting `px server`, which the plan lists as the verification for this step and which is now the reason the plan lists it. The path is `dist/node-index.js` in both branches.

**JSX in core tests, for real this time.** The old rule ("no JSX in core tests") existed because `.swcrc` set React as the import source for everything. With tsc and Vite reading tsconfig, core's tests tsconfig sets `jsxImportSource: "@positronic/core"` and the two React packages (cli, gen-ui-components) keep the React default. Two things had to give before a `.test.tsx` in core actually ran:

- Vite in dev mode imports `jsxDEV` from `<importSource>/jsx-dev-runtime`, not `jsx` from `jsx-runtime`. Core had no such entry, so the test file failed to load. Core now ships `src/jsx-dev-runtime.ts` and exports it from package.json. This was a real gap: anyone testing a `.tsx` brain with Vitest in a generated project would have hit the same error.
- Typecheck resolved `@positronic/core/jsx-runtime` through the package's `exports` to `dist/jsx-runtime.d.ts`, while the tests import `TemplateNode` from `../src`. `Fragment` is a `unique symbol`, so the two declarations are distinct types and a JSX element was "not assignable" to `TemplateChild`. A `paths` entry in the tests tsconfig points the subpath at the source file, and the Vitest alias does the same at runtime. The first attempt put `jsx` and that `paths` entry in the root tsconfig; with `jsx` set, tsc resolves the import source for every file in a program, so every other package's build pulled `packages/core/src/jsx-runtime.ts` in and failed on `rootDir`. The settings belong to core alone. That in turn moved the tests: Vite applies the nearest tsconfig that includes a file, and core's build config includes only `src`, so a `.test.tsx` under `tests` was still compiled with the React default and produced React elements. `packages/core/tests/tsconfig.json` (extending core's config, `noEmit`, including `tests` and `src`) is now the nearest config for the tests. It replaces `tsconfig.check.json`, whose only job was typechecking core tests against source, and the root tsconfig excludes `packages/core/tests` so they are checked once.

`packages/core/tests/jsx-syntax.test.tsx` adds two tests that go through the real transform: a function component with children, and a `.prompt()` step given a JSX message. Renderer behaviour (conditionals, lists, built-in components) stays covered by the manual trees. The manual-tree tests in `jsx-template.test.ts` stay as they are.

**Verified.** `npm run dev` exits 0 with 645 root tests and 235 cloudflare tests, `npm run typecheck` exits 0, `node packages/cli/dist/positronic.js --help` works, and a project scaffolded with `scaffoldProject({ devRootPath })` plus `npm install` starts with `px server` and answers on `/brains`.

## Learnings

- A path assembled from segments is invisible to a grep for the joined string. When changing an output layout, grep for the last segment (`node-index`) as well.
- The CLI tests never exercise the real backend loader. Scaffold-and-serve is the only check that does, and it takes about a minute.
- With a custom `jsxImportSource`, dev tooling (Vite, Vitest) wants `jsx-dev-runtime` too. Shipping only `jsx-runtime` works for production bundlers and breaks in dev.
- Self-referencing a package subpath during typecheck resolves to `dist`, and `unique symbol` declarations in `dist` and `src` are not the same type even when the files are identical.
- `jsx: react-jsx` makes tsc resolve `jsxImportSource` for every file in the program, `.ts` included. A `paths` entry for it that points outside a package's `rootDir` breaks that package's build, so JSX settings stay per package.
- Vite (rolldown's tsconfig resolver) applies the nearest tsconfig whose `include` covers the file. A package config that includes only `src` does nothing for `tests`; give the tests their own tsconfig.

## Dead ends

- Keeping the `dist/src` and `dist/types` layout by pointing `outDir` at `dist/src` would have left every package.json untouched. Rejected: it is an SWC artefact, spec and template-new-project were already flat, and the mixed layout was the reason the CLI had a hand-built path in the first place.
- Rewording the CLAUDE.md caveat without making JSX work in core tests. The plan called for removing the rule, and the two blockers turned out to be one missing file and one `paths` entry.

### 2026-09-05 — review loop

One pass. The reviewer's main point held: core's source has no JSX, so `jsx`, `jsxImportSource`, and `paths` belong in `packages/core/tests/tsconfig.json`, not in the build config where the `paths` and `rootDir` pairing had already bitten once. Core's build config is now identical in shape to mem0 and client-vercel. Also taken: `jsx-dev-runtime.ts` re-exports everything from `jsx-runtime` (so `File`, `Resource`, `Form`, and the `JSX` namespace are there if a project ever sets `react-jsxdev`), the JSX test file drops the test that only re-covered the renderer, and cloudflare's tsconfig `include` narrows to `src/**/*` like every other package, since with tsc emitting a non-test helper under `tests/` would have failed `rootDir`.

A second pass argued the other way on the JSX work (drop it, reword the rule) and repeated the `backend.ts` point, so the loop stopped there. Two things from it were worth taking. `loadBackendModule` now resolves the package root in one expression and spells `dist/node-index.js` once. And `packages/cli/tests/backend.test.ts` calls `createDevServer` against a fake backend laid out like the real one, for both the `file:` and installed cases; it is the test that would have caught this step's only regression, and it needs no build. Smaller: the tests tsconfig includes only `tests` (core's source is checked by its own build), the alias for the jsx subpaths now sits before the general `@positronic/*` alias, and cloudflare's tsconfig `exclude` lost the entries that `include: src/**/*` made dead.

Declined: storing the bare package name in `positronic.config.json` so `backend.ts` collapses to one branch. That changes what the scaffolder writes and what existing projects have on disk, and it is not a build-toolchain change. Noted as a follow-up.

## Leftovers

- The template's `vitest.config.ts` includes only `tests/**/*.test.ts` and its tsconfig only `brains/**`, so a generated project cannot yet write a `.test.tsx` against a JSX brain. The dev runtime is in place for when that glob widens.
- `backend.ts` still distinguishes `file:` from installed backends. The `file:` spec ends up symlinked into `node_modules` anyway, so the config could store the package name and the loader could resolve through `exports` instead of spelling `dist/node-index.js`.

## Solution

`tsc` is the only compiler. Output is flat under `dist/`. The root tsconfig owns the default JSX import source and the React packages opt out. Core ships both JSX runtimes. The CLI loads backends from `dist/node-index.js`.
