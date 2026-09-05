# json-render step 3: bundle build, template, and the first end-to-end page

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 31e730d0..79ca6ad5
**Plan:** `docs/json-render-plan.md` (step 3)
**Previous step:** `docs/journal/2026-09-05-json-render-step-2-gen-ui.md`

## Goal

Make a fresh project render the pages core now generates: the dev server
builds the browser bundle (React inside) and a Tailwind stylesheet and
serves both from `/bundle/`; the project template ships the entry files,
the catalog, and docs that match. Then prove it with a scaffolded project
in a browser, which no automated test does.

## Log

### 2026-09-05 — implementation and verification

What we did: `buildAndUploadBundle` runs esbuild (no externals, automatic
JSX, minified) and the Tailwind CLI, uploads both outputs; the bundle route
serves `.js` and `.css`; the template gets `.positronic/styles.css`,
`src/components/browser.ts`, React 19 and Tailwind 4 dependencies, and
rewritten docs. The CLI watcher now forwards `src/components/` changes.

**Two files in `src/components/`, not one.** The catalog file is imported
by the brain (a Worker) and by the browser bundle, so it must stay free of
React; the React implementations are imported only by the bundle. Splitting
`index.ts` (catalog) from `browser.ts` (implementations) keeps React out of
the Worker build and Node out of the browser build. Custom React components
in a project need `/** @jsxImportSource react */` because the project
tsconfig points JSX at Positronic's prompt runtime; `browser.ts` documents
that.

**Tailwind sources live in the theme file.** Tailwind only generates
classes it sees in scanned files, and the shadcn implementations sit in
`node_modules`. Rather than have every project spell out `@source` paths,
`theme.css` declares them relative to itself: `./dist` (this package),
`../../@json-render/shadcn/dist` (a normal install, where the two packages
are siblings), and `../../node_modules/@json-render/shadcn/dist` (a project
linked to the monorepo with `file:`, where npm does not install the linked
package's dependencies and the shadcn dist is hoisted to the repo root).
Tailwind silently skips paths that do not exist, confirmed with a probe, so
listing both layouts costs nothing. The project's `styles.css` is three
lines.

**The CLI watcher never watched components.** The dev server's `watch()`
had a `src/components/` branch since the original bundle work, but the CLI
only ever passed `src/brains/`, `resources/`, and `.env` to chokidar, so
the branch was dead code. Two lines in `packages/cli/src/commands/server.ts`
fix it; a component edit now rebuilds JS and CSS in about a second.

**`bundle.ts` imports `../src/components/` directly.** The old entry went
through the `.positronic/components` symlink the dev server creates, so
`npm run build:components` failed on a fresh checkout until a server had
run. The direct relative import removes that dependency.

**The template's default model was retired.** `gemini-3-pro-preview`
returns "no longer available"; every fresh project's brain failed before
reaching page generation. Sean asked for a `-latest` alias so this cannot
recur; Google offers `gemini-flash-latest`, `gemini-flash-lite-latest`, and
`gemini-pro-latest`, and the template now uses `gemini-flash-latest`. The
governor logs "no rate limits known" for it because the rate-limit table is
keyed by concrete model names; a follow-up, not a blocker.

**Verification: it works end to end.** Scaffolded a project into the
scratchpad with `file:` links, installed, `npm run typecheck` clean,
`npm run build:components` produced a 991 KB script with no bare `require`
and a 68 KB stylesheet with the shadcn classes present. Started the dev
server, ran a `.page()` brain with three seeded emails, a checkbox per
email, an optional note, and an Archive button. Gemini's first spec was
exactly the intended shape (Card, repeat over `/emails`, Checkbox with
`value: {$item: id}` bound to `/form/archiveIds`, Textarea bound to
`/form/note`, Button with `[validateForm, submitForm]`) with no repair round.
The page rendered with shadcn styling and no console errors; ticking two
boxes, typing a note, and pressing Archive posted `archiveIds=e1&e1...`
style FormData, the brain resumed, and its next step logged
`Archiving e1, e3 (note: Handled in the standup)`. The template's `hello`
brain (the `generatePage` tool inside a prompt loop) also produced a
working form.

**Things noticed, not fixed.** The dev server writes the origin as
`http://localhost:8787` regardless of `--port`, so form actions on a custom
port point at the wrong server; testing moved to the default port. A
project scaffolded with `scaffoldProject()` directly (not `px project new`)
has no `ROOT_PUBLIC_KEY` and the dev server rejects every request until one
is written to `.env`; `px project new` runs the interactive key picker that
does this, so only the by-hand path hits it.

## Learnings

- Check that a "watcher" branch is actually reachable from the process
  that owns the watcher before relying on it in a plan.
- Tailwind v4 tolerates missing `@source` paths, which makes it possible to
  ship scan paths inside a package's CSS and cover more than one install
  layout.
- For a manual check of a scaffolded project, use `px project new` (or copy
  a `ROOT_PUBLIC_KEY` line) and the default port; both saved a detour here.

## Dead ends

None.
