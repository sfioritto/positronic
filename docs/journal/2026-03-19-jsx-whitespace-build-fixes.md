# JSX Whitespace Build Step Fixes

**Status:** active
**Started:** 2026-03-19

## Goal

Fix the esbuild whitespace-preservation plugin that was added for JSX brain files. The original commits (b7cbcb3, 117a178) introduced `build-brains.mjs` into the project template but had several issues that prevented it from working end-to-end. Evolved into a project structure redesign to cleanly handle compiled output.

**Why:** The JSX prompt template feature needs a pre-compilation step that wraps JSXText nodes in expression containers to preserve whitespace. Without it, the JSX compiler collapses newlines to spaces, breaking the "what you see is what you get" promise.

## Log

### Caz template processing vs `file.binary` (2026-03-19)

The first bug: `build-brains.mjs` contains `` `{\`${escaped}\`}` `` — a JS template literal with `${escaped}`. Caz uses lodash `_.template()` which interprets `${...}` as interpolation. When `px server` regenerates `.positronic/`, caz tried to evaluate `escaped` as a variable → `ReferenceError: escaped is not defined`.

Commit 117a178 tried to fix this by setting `file.binary = true` in the caz `prepare` hook. **This doesn't work.** Dug into caz's minified source and found the render step calls `isBinary(file.contents)` — it inspects the buffer for binary characteristics (null bytes etc.), not a property flag on the file object. A `.mjs` text file will never pass that check.

**Fix:** Escape via caz's own syntax: `<%= '${escaped}' %>` renders as the literal `${escaped}` in the output.

### Wrangler CWD and build command paths (2026-03-19)

Second set of bugs, never caught because the caz error happened first. Wrangler is spawned with `cwd: serverDir` (line 761 of dev-server.ts), where `serverDir = .positronic/`. So:

- `build.command: "node .positronic/build-brains.mjs"` → would look for `.positronic/.positronic/build-brains.mjs` → wrong
- `findTsxFiles('brains')` in the script → would look for `.positronic/brains/` → wrong

**Fix:** Command becomes `"node build-brains.mjs"`, script scans from `../src/brains`.

### The compiled output location problem (2026-03-19)

Moving compiled `.js` files to `.positronic/brains/` broke relative imports. Brain files have imports like `from '../brain.js'` and `from '../services/gmail.js'` — these are relative to the source file's location in `brains/`. Moving the compiled output to `.positronic/brains/` means `../brain.js` resolves to `.positronic/brain.js` instead of the project root's `brain.js`.

Consulted external input on three approaches:

1. **Symlinks** — mirror the project structure in `.positronic/` via symlinks so relative imports resolve through them
2. **Path aliases** (`@/brain.js`) — explicit but requires API change and migration
3. **In-place with `.gen.js` extension** — zero resolution issues but files still in source tree

### Project structure redesign: `src/` directory + symlinks (2026-03-19)

Chose symlinks, but realized it's cleaner with a `src/` directory convention. Key insight from the user: "why not compile ALL brain files, not just .tsx?" — since we have a build step now anyway, compile everything. This eliminates the `.tsx` vs `.ts` bifurcation in the manifest.

**New structure:**

- `src/` contains all bundled code: `brain.ts`, `brains/`, `webhooks/`, `services/`, `utils/`, `components/`, `runner.ts`
- `resources/`, `tests/`, `docs/`, config files stay at project root
- `.positronic/` gets symlinks to `src/*` (except `brains/`) so compiled brains' relative imports resolve
- `build-brains.mjs` compiles ALL `.ts` and `.tsx` files from `src/brains/` into `.positronic/brains/`
- Manifest imports ALL brains from `../brains/` — one path, no bifurcation

The symlink approach works because compiled files at `.positronic/brains/my-brain.js` import `../brain.js` which resolves to `.positronic/brain.js` → (symlink) → `src/brain.ts`.

## Learnings

- **Caz's binary detection is content-based, not flag-based.** Setting `file.binary = true` in the prepare hook is a no-op. The render step calls `isBinary(file.contents)` which checks the buffer for null bytes. The only way to get literal `${...}` into output is `<%= '${...}' %>`.
- **Wrangler's build.command CWD is the directory containing wrangler.jsonc.** When the dev-server spawns wrangler with `cwd: .positronic/`, all build paths must be relative to `.positronic/`.
- **Moving compiled files breaks relative imports.** This is fundamental — you can't relocate compiled output without either rewriting imports or making the surrounding filesystem match. Symlinks solve this at the OS level.
- **Compile everything, not just .tsx.** Once you have a build step, there's no benefit to treating `.ts` and `.tsx` differently. Compiling all brain files eliminates manifest bifurcation and means `./` imports within brains (e.g., `./helpers.js`) resolve correctly because all files end up in the same output tree.
- **A `src/` convention makes symlink boundaries explicit.** Instead of "scan project root and exclude things," it's "symlink everything in `src/` except `brains/`." Clear, predictable.

## Dead ends

- **`file.binary = true` in caz prepare hook:** The template-new-project CLAUDE.md described this as working but it doesn't. Caz checks buffer content, not object properties.
- **Bifurcated manifest paths (`.tsx` → `../brains/`, `.ts` → `../../brains/`):** First attempt at handling compiled output in `.positronic/brains/`. Worked for single files but broke on relative imports within the compiled files.
- **In-place output with `.gen.js` extension:** Would work but keeps artifacts in the source tree. The user preferred a cleaner approach.
