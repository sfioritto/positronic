# Page bundle: esbuild to Vite

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 6e5a3c0d (Vite build), d4f77017 (catalog import)

## Goal

The generated-page bundle came out of the json-render rebuild at 991 KB minified, 265 KB gzipped. The step 2 journal blamed `@json-render/shadcn` exporting all 36 component implementations in one object. Sean asked to see the options, so the first job was to find out where the bytes actually go.

## Log

### The measurement contradicted the journal

esbuild's metafile on the demo bundle: zod 434 KB, react-dom 181 KB, shadcn plus Radix plus vaul plus embla about 260 KB, json-render 59 KB, our code 13 KB. The shadcn all-36 problem is real but worth about 140 KB, not the bulk. Zod is the bulk, and 254 KB of zod is its locale files (Hebrew, Russian, Tamil, 62 of them).

### Why zod is 434 KB: one import style

Zod's entry does `import * as z from './external.js'; export { z }`. That `z` is a namespace object exported by name. When a consumer writes `import { z } from 'zod'`, esbuild receives an object built somewhere else and cannot know which properties will be read, so it keeps every export of `external.js`, including `export * as locales` and the whole core surface (JSON Schema conversion, the compiler). With `import * as z from 'zod'` the namespace is built in the importing file, property reads are static, and everything unused drops out. Same two-line program: 433 KB one way, 81 KB the other. Locales collapse to English only.

json-render uses the `{ z }` form in five places (four in core, one in shadcn) and so did our `catalog.ts`. One importer is enough to force the full object for everyone. Zod's own docs use `import * as z`. Zod's other answer, Zod Mini, is a functional API at 12 KB, but json-render is on the classic API so that is not available to us. Sean decided not to send json-render a PR.

### Rolldown handles it

Vite 8 is already in generated projects through Vitest 4, and Vite 8 bundles with Rolldown. Rolldown tree-shakes the re-exported namespace object that esbuild cannot. Building the same entry with Vite in library mode, IIFE output: 640 KB minified, 190 KB gzipped, no zod locales. That beats esbuild plus an import-rewrite plugin (673 KB / 204 KB) and needs nothing from upstream.

### Library mode leaves `process.env.NODE_ENV` alone

First Vite build came out at 1,029 KB with react-dom at 1.3 MB pre-minify and 16 `process.env.NODE_ENV` references left in the output. Library mode deliberately does not replace it, on the theory that a downstream bundler will. Here the script runs in the browser as is, so React's development build shipped and the page would have thrown `process is not defined`. `define: { 'process.env.NODE_ENV': '"production"' }` fixes it; the config carries a comment because this will bite the next person too.

### Verified end to end

Dev server builds through `vite build --config .positronic/vite.config.mjs --logLevel warn`, uploads 640 KB, the review brain's page renders with shadcn styling, checkboxes and textarea work, submit posts the form and the brain resumes (`Archiving e1, e3 (note: Vite bundle check)`), no console errors. Editing a component file triggers a rebuild through the same path.

## Learnings

- Measure before naming a culprit. The step 2 journal's "bulk is shadcn" was a guess dressed as a finding; the metafile took two minutes and said otherwise.
- `import { z } from 'zod'` versus `import * as z from 'zod'` is a 350 KB difference under esbuild. Any library that re-exports a namespace object by name has this shape.
- Vite library mode requires `define` for `process.env.NODE_ENV` when the output runs directly in a browser. Also requires `lib.name` for IIFE even with no exports.
- Rolldown does not expose its transform or parser as importable APIs (`rolldown/experimental` has only a Vite transform plugin), so Vite helps bundles and nothing else.
- The bundle route serves `Cache-Control: no-cache`; repeat page loads refetch 190 KB. Not addressed here.
- TypeScript 7's `typescript` package exports only `version`; the compiler API (`createSourceFile`, `transpileModule`) is gone and `build-brains.mjs` breaks on any `.tsx` brain. Found while looking for a way to drop esbuild there. Separate effort, next.

## Dead ends

- **Stub zod's locales to English with an esbuild plugin.** Worked (763 KB / 228 KB gzipped) but only saved 38 KB gzipped, since repeated locale strings compress well, and it depended on zod's internal file layout. Superseded by Rolldown's tree shaking.
- **Rewrite `import { z }` to `import * as z` in json-render's dist at build time.** Worked (673 KB / 204 KB gzipped). Also superseded, and it would have been a regex over someone else's shipped files.

## Solution

Vite library mode replaces the esbuild CLI for the page bundle, in the template config and the dev server, with `process.env.NODE_ENV` defined so React's production build ships. Rolldown's tree shaking removes the zod bloat without any change to json-render. Our own catalog imports zod as a namespace so it is not the importer that forces the full object under other bundlers. Remaining levers (shadcn subset, bundle caching) are recorded above and not taken.
