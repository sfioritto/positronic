# Brain build: esbuild to oxc

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 8d6c7c71

## Goal

Step 2 of the post-json-render cleanup: take esbuild out of the generated project's own configs (wrangler keeps its internal copy) by moving `build-brains.mjs` off it. While scoping that, found that `.tsx` brains had been broken in generated projects since TypeScript 7 landed earlier the same day.

## Log

### The plan that did not survive contact

The idea was `ts.transpileModule`: the plugin already imported `typescript` for its parser, so swapping the transform to TypeScript's single-file compile would drop esbuild with no new dependency. TypeScript 7 removed that whole surface. The `typescript` package now exports `version` and nothing else at the top level; the compiler API lives under `typescript/unstable/*` as a client to the native binary, and the AST package there has a scanner and visitors but no standalone parser.

### Which meant `.tsx` brains were already broken

The whitespace plugin called `ts.createSourceFile`. A `.tsx` brain dropped into the demo failed the build with `Cannot read properties of undefined (reading 'Latest')`. `.ts` brains kept working because the plugin only ran on `.tsx`. Nothing caught it: no test exercised the brain build, and neither the test project nor the template has a `.tsx` brain. Modernization step 4 shipped it without anyone noticing.

### oxc-parser and oxc-transform

The plugin needs two things: a parser that reports JSX text nodes with byte offsets, and a TSX to JS transform. oxc-parser's ESTree output has `JSXText` nodes with `start`/`end`, and oxc-transform takes `jsx: { runtime: 'automatic', importSource }`. The rewrite step is identical to the old one (wrap each text node in `{`...`}` with backticks, backslashes and `$` escaped, apply from the end of the file backwards); only the parser and transform changed. Both packages are from the oxc project, the same family as oxlint and oxfmt, so this stays in the toolchain Sean already picked. Rolldown, which is what Vite 8 bundles with, does not expose either as an importable API, so Vite could not do this job.

### Output paths were latently wrong too

The esbuild version passed all brain files as entry points with `outdir: 'brains'` and let esbuild pick the output base as the lowest common ancestor. With brains in `src/brains/a.ts` and `src/brains/sub/b.ts` that is `src/brains`, which is what the manifest expects. If every brain lived in one subdirectory, the base would have been that subdirectory and the manifest's `../brains/sub/b.js` would not exist. The rewrite computes each output path relative to `src/brains` explicitly.

### The test

`packages/template-new-project/tests/build-brains.test.ts` scaffolds a project into a temp dir inside the package (so the compiled brains resolve `oxc-*` and `@positronic/core` from the monorepo root), writes a `.tsx` brain with a multi-line JSX fragment, runs `build-brains.mjs` as wrangler would, imports the compiled file and renders it with core's `renderTemplate`. The first version of the fixture taught me two things about the renderer: it dedents, and `$` before a `{...}` in JSX text is literal text followed by an expression, so my "wrong" output was correct. The second test covers the nested-directory layout and `_`-prefixed skipping; the third checks a parse error names the file.

## Learnings

- TypeScript 7 is a native binary with a thin JavaScript shim. Anything that imported `typescript` for `createSourceFile`, `transpileModule`, or `SyntaxKind` needs a new home. Grep for `from 'typescript'` outside type checking before the next TypeScript bump.
- A build step nobody tests will break silently. The brain build ran on every `wrangler dev` and still nobody saw the failure, because the failing path needed a `.tsx` file and none existed anywhere in the repo.
- esbuild's multi-entry `outdir` derives its base from the entries, not from a directory you name. Fine until the entries all share a prefix.
- `renderTemplate` dedents. Assertions on rendered JSX prompts should expect the dedented form.

## Dead ends

- **`ts.transpileModule`.** Would have been zero new dependencies. Gone in TypeScript 7 along with the parser the plugin depended on.
- **Vite for the brain build.** Wrong shape: a bundler asked to not bundle, and Rolldown's transform is not exposed anyway.

## Solution

`build-brains.mjs` parses `.tsx` brains with oxc-parser, wraps JSX text nodes in template literals, compiles with oxc-transform, and writes each file to `brains/` at its path relative to `src/brains`. The template depends on the two oxc packages instead of esbuild. A test builds a fixture `.tsx` brain through the real script and renders the result, so the next toolchain change that breaks this path fails in CI instead of in someone's project.
