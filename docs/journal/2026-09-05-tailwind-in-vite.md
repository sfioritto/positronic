# Tailwind into the Vite build

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 129c0853

## Goal

Step 3 of the post-json-render cleanup. After the page bundle moved to Vite, the dev server still ran two commands for one artifact set: `vite build` for `components.js` and the Tailwind CLI for `components.css`. The question was whether `@tailwindcss/vite` could fold the stylesheet into the same build without complicating the dev server's watch and upload path, and whether the output would match.

## Log

### It fits without changes to the flow

`bundle.ts` imports `./styles.css`; Vite library mode with `cssCodeSplit` off (the default there) emits one stylesheet, and `lib.cssFileName: 'components'` names it `components.css` next to `components.js`. The dev server's upload loop already keyed both files by R2 path, so removing the Tailwind execSync was the whole change on that side. `styles.css` itself is untouched: `@import "tailwindcss"`, the gen-ui theme import, and `@source "../src/components"` all resolve relative to the CSS file exactly as they did under the CLI.

### The CLI output was carrying junk

The plugin's stylesheet came out at 56 KB against the CLI's 68 KB, which looked like a problem until the selector sets were compared properly (same `LC_ALL=C sort` on both sides; the first comparison mixed JavaScript and `comm` collation and reported phantom differences). Result: every selector in the plugin output is in the CLI output, and 88 selectors are CLI-only: `.antialiased`, `.capitalize`, `.contents`, `.backdrop-sepia`, `.diagonal-fractions`, `.rounded-ss`, and so on. None appear in gen-ui's dist, shadcn's dist, or the project's components. All appear in the previously built `.positronic/dist/components.js`. Tailwind's CLI auto-detects sources from the working directory and was reading the minified React bundle, where identifiers and string literals happen to spell utility names. So the CLI stylesheet depended on the last JS build and grew by whatever words fell out of it. The Vite plugin scans the module graph and the declared `@source` paths, and does not read its own output directory.

### `@theme inline` means no `--color-*` variables

A spot check for `--color-primary` in the served CSS found nothing and briefly looked like missing tokens. The gen-ui theme declares tokens with `@theme inline`, which inlines values into utilities (`.bg-primary { background-color: var(--primary) }`) rather than emitting `--color-primary`. `--primary` and `.bg-primary` were both present. The browser render was the real check: cards, borders, button, spacing all as before, no console errors.

### Review loop: two passes that disagreed

Pass one wanted the dev server to stop hardcoding `components.js` and `components.css` and upload whatever Vite wrote to `dist` instead, so the config would be the only place output names live. Pass two, seeing the result with fresh eyes, called it a regression: `readdir` is not recursive, so the first stylesheet that references a font makes Vite emit `dist/assets/` and the upload of a directory throws, downgrading the whole build to a warning with no JS or CSS. And `/bundle/*` is public and unauthenticated, so an explicit map is a whitelist while a directory listing publishes anything a future Vite option emits. Both points hold, and since `generatePageHtml` in core hardcodes the two names anyway, the map is the honest design. Reverted to it. Kept from pass one: the dead `mkdir`, the redundant `emptyOutDir` line, a comment on `cssFileName` naming the coupling to `page-html.ts`, and trimming the same pipeline paragraph out of three file headers so `vite.config.mjs` owns it.

Pass one also raised a structural option: have the dev server own the Vite config inline through Vite's Node API, so projects ship no build config and no build devDependencies. That trades away the escape hatch for project-specific Vite plugins. Left for Sean to decide.

## Learnings

- Tailwind CLI's automatic source detection includes build outputs in the working directory unless they are gitignored. A stylesheet built next to a minified JS bundle will pick up utility names from that bundle's identifiers. Declare sources or use a tool that scans the module graph.
- When comparing sorted lists from two tools, sort both with the same collation before `comm`. The first pass here produced 19 false "only in Vite" entries.
- `@theme inline` emits no `--color-*` custom properties; check for the utility class or the underlying token instead.
- Vite lib mode: `lib.cssFileName` controls the stylesheet name; `emptyOutDir` already defaults to true for an outDir inside the root, so the old `false` just needed deleting.
- An upload step to a public path should enumerate what it publishes. A directory listing is convenient until the build emits something you did not mean to serve.

## Solution

`bundle.ts` imports `styles.css`; `@tailwindcss/vite` in the template's Vite config emits `components.css` alongside `components.js`; the dev server runs one `vite build` and uploads the two named files. The CLI and its devDependency are gone, and so are 88 junk utilities the CLI had scraped from the previous JS bundle.
