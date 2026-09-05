# Replace caz with Eta in the project template

**Status:** shipped
**Started:** 2026-09-04
**Shipped:** 2026-09-05
**Commit:** 9f221517

## Goal

Sean: "i have so many problems with caz." The scaffolder for `px project new` and the dev server's `.positronic/` regeneration was caz, a CommonJS scaffolding framework with opinions about prompts, npm, git, and stdout that we kept working around. Replace it with something that only renders files, and put install and git init back under our control.

## Log

### Why not plain string replacement

First suggestion was a hand-rolled copy-and-replace with `{{name}}` placeholders. Sean's reaction: "something about string replacing gives me the heebies." Fair. The template has real conditionals (the cloudflare dependency blocks in three package.json files), and a homegrown replacer either grows logic or forces those files into JS. Eta keeps the template files declarative.

### Why Eta

Health check on 2026-09-04: 1.7k stars, 6.7M weekly downloads (Docusaurus ships it), v4.6.0 released April 2026, 61 commits in the last year, 7 open issues, zero runtime deps, dual ESM/CJS with real `exports`, Node 20+. Small, maintained, not going anywhere.

The decisive fit: caz renders with lodash templates, and Eta's default tags are the same `<%` `%>` with `=` for interpolation. Every template file migrated with no syntax edits.

### The `${}` escaping was lodash, not caz

The template had 74 wrappers like `<%= '${state.task}' %>`. I assumed caz needed them. The real reason is that lodash `_.template` also treats `${...}` as an interpolation delimiter, so every JS template literal in every doc and code sample had to be smuggled through as a string expression. Eta only recognizes its configured tags. All 74 wrappers are now plain `${...}`, and the template CLAUDE.md no longer needs an escape rule.

Migration script evaluated each wrapper's inner string literal with `new Function('return ' + lit)()` rather than regex-unescaping, because a few contained `\'` and `\\n` that had to round-trip exactly.

### Eta config that matters

- `autoTrim: false`. Eta's default trims one newline after a closing tag. That would have folded `"..."<% } %>\n  },` onto one line in package.json. Valid JSON, but noisy diffs against the old output. Turning it off gives byte-identical output for tag-free files (verified with `cmp`).
- `autoEscape: false`. Default XML-escapes interpolations. Wrong for code and JSON.
- `useWith: true`. Bare `name` instead of `it.name`, so the existing templates work unchanged.

### One behavior difference

lodash renders `null` as an empty string. Eta renders the string `null`. The `none` backend's `backendPackage` was `null`, which produced `"package": "null"` in positronic.config.json. The CLI's backend loader calls `.startsWith` on that field, so it must stay a string. Changed the data to `''`, matching the old output.

### Versions come from the template's own package.json now

The old `index.js` hardcoded `'^0.0.79'` four times. Changesets bumps package.json files, not JS source, so those strings drifted or needed hand edits. `templateData()` now reads the template package's own version and writes `^<version>`. All packages release in lockstep, so this is the range we wanted anyway.

### What got simpler at the call sites

- No more copying the template package to a temp dir. That existed because caz ran `npm install --production` inside the template directory, which trashed the monorepo's node_modules when `POSITRONIC_LOCAL_PATH` pointed at it.
- The dev server no longer mutates `process.env.POSITRONIC_LOCAL_PATH` to pass a value to the template's setup hook. It passes `devRootPath` as an argument.
- Test global setup no longer monkey-patches `process.stdout.write` to silence caz, and scaffolding is synchronous with no subprocesses. The `project new` test's 1500-retry wait (15s, to absorb caz's npm install) dropped to 50.
- `deps.interopDefault: false` left vitest.config.ts. Its only stated reason was caz's CJS default-export shape.

### Prompts are gone

caz prompted for backend (four of six choices were disabled), install, package manager, and CLAUDE.md. Every real call site passed answers programmatically, and the only interactive path was `px project new` outside tests. Now: cloudflare backend, CLAUDE.md included, `npm install`, `git init`. If flags are wanted later they belong on the yargs command, not in the template.

### 2026-09-05 — review loop

Two fresh-context review passes. Both led with "drop the `none` backend, then Eta is unnecessary, use a regex." Declined both times: Sean picked Eta over string replacement on purpose, and the conditionals in the three package.json files are exactly what a regex can't do cleanly. Everything else the reviewers raised was worth taking:

- The `swc` script emitted a dead `dist/src/index.js` next to tsc's `dist/index.js`. spec has the same quirk. Here it was a trap, because `packageRoot` is computed as one directory up from the entry file. Build is tsc only now.
- The dev server was scaffolding a whole project into a temp dir to copy out `.positronic/`. A `subdir` option renders that subtree straight into the server dir. About 45 lines gone.
- Monorepo detection moved into the template package as the default `devRootPath`. Side effect worth knowing: `px project new` run from a monorepo checkout now writes `file:` references without `POSITRONIC_LOCAL_PATH`. Before, only the dev server auto-detected.
- The once-per-run scaffold cache in test global setup existed because caz took ~3s. One `scaffoldProject` call is ~36ms (20-run average), so `createMinimalProject` calls it directly and the global setup, the provide/inject plumbing, and both vitest `globalSetup` entries are gone. Ironic, since that global setup was added the previous night specifically to work around caz.
- A real regression from my first pass: an `npm install` failure dead-ended the flow before auth setup, which doesn't need node_modules. Now the failure is recorded, the flow continues to auth setup, and the success screen shows which command failed.
- `renames` was keyed on the pre-strip path under `subdir`. Latent, fixed.

Flake note: `resources.test.ts > should correctly identify text vs binary files` failed in three of five full runs tonight with a `waitForOutput` timeout on `resources sync`, and passed 3/3 alone. Load average was 6 to 10 on 12 cores. The two later sync tests in that file used the default 10 tries at 10ms, a 100ms budget to sync seven files, while the first sync test in the same file allows 50. Matched them to 50. Three full runs then passed at load average 10.

## Learnings

- When a template engine forces escaping of `${}`, check whether it is the engine's interpolation syntax rather than the scaffolder. Lodash templates have three delimiters, and the ES one bites JS-heavy templates.
- Eta's `autoTrim` default is `[false, 'nl']`, not off. Set it explicitly when output whitespace matters.
- The template package is now a normal TS workspace package (`src/` plus `dist/`, built with tsc and swc like spec). The root tsconfig references it and excludes only its `template/` directory, since those files are rendered, not compiled.

## Dead ends

- **A separate `install_failed` UI state.** First fix for the silent-install problem. Made the install failure a terminal screen, which skipped auth setup and left new projects without a root key. Install and git init are best-effort steps; the fix was to record the failure and keep going.

## Solution

`@positronic/template-new-project` is now a normal TypeScript workspace package exporting `scaffoldProject()`. It renders `template/` through a single Eta instance (`autoEscape: false`, `autoTrim: false`, `useWith: true`) and writes the files. The CLI calls it and then runs `npm install` and `git init` itself, outside tests. The dev server calls it into a temp dir and copies out `.positronic/`. Test global setup calls it synchronously.

Eta won over a hand-rolled replacer because the template's conditionals stay declarative, and over other engines because its default tags match what lodash already used, so the migration was config rather than rewriting. After the review loop: the template package builds with tsc alone, the dev server renders `.positronic/` in place via `subdir`, monorepo detection lives in the template package, tests scaffold per test with no global setup, and install failures are reported on the success screen instead of blocking auth setup. Root suite 641/641 three times running, cloudflare suite 235/235, typecheck clean. Sean also had gen-ui-components added to the changeset linked group so the single-version assumption holds.
