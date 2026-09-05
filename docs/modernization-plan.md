# Modernization plan

**Status:** planning
**Started:** 2026-09-04

Bring Positronic's tooling in line with how Monocles is set up: Vitest instead of Jest, TypeScript 7 doing its own emit instead of tsc plus SWC, React 19, and oxlint. One step at a time, in order. Each step ends with a green `npm run dev` and `npm run typecheck`, a code review pass, and a commit Sean approves.

The steps are ordered by dependency. Vitest replaces the Jest config that SWC feeds. Dropping SWC changes what tsc emits, which the TypeScript 7 step then tightens. The React bump touches the CLI package that step 1 migrates. Do not run them in parallel.

Each step has a **Tweaks** line for Sean to fill in before work starts.

## Where things stand

| Tool        | Monocles        | Positronic today                              |
| ----------- | --------------- | --------------------------------------------- |
| TypeScript  | 7.0.2           | 5.8.3                                         |
| Test runner | Vitest 4.1      | Jest 29.7 (test-project: Vitest 3.0.9 pinned) |
| Transpiler  | Vite / Rolldown | SWC 1.11 + tsc                                |
| React       | 19.2            | 18.3 in CLI, @types/react 19                  |
| Ink         | n/a             | 5.2 (7.1 needs React 19)                      |
| Linter      | oxlint 1.78     | none                                          |
| Formatter   | none            | Prettier 2.8                                  |
| @types/node | 24              | 20 and 22, mixed                              |

Not on this list: Storybook and shadcn for gen-ui-components. Sean cut that one.

**In-flight work to carry forward.** There are uncommitted coverage changes in jest.config.js, the root package.json, and the test-project vitest config (see `docs/journal/2026-09-04-test-coverage-setup.md`). Step 1 has to preserve what they do: report every source file, not only imported ones, and split ownership of `packages/cloudflare/src` so Jest reports only `dev-server.ts` and `node-index.ts`. Commit or stash that work before step 1 starts so the migration diff is clean.

## Step 1: Jest to Vitest at the root

**Scope.** Replace Jest 29 with Vitest 4 for every package that runs under the root config. Keep the three-project split (cli with the nock safety net, cli-server without it, everything else). Drop the experimental VM modules flag, the SWC transform, the `.js` extension mapper, the robot3 mapper, and the ink transformIgnorePatterns list. Native ESM should make all of that unnecessary. If one of them turns out to still be needed, write down why in the journal.

Also migrate the template project's jest config (`packages/template-new-project/template/jest.config.js`, currently Jest 30 with ts-jest) so new projects scaffold with Vitest. No test verifies the template, so scaffold a project with `px project new` and run its test script by hand.

Vitest 5.0 is out, but the Cloudflare workers pool peer wants 4.1, so use 4.x here to keep one version across root and test-project.

**Files touched.**

- `jest.config.js` becomes `vitest.config.ts` with `test.projects`. Coverage config moves to `test.coverage.include` and `exclude`.
- `package.json` scripts: `test`, `test:noisy`, `test:coverage`, `test:watch`. Remove `@jest/globals`, `@types/jest`, `jest`, `@swc/jest`. Add `vitest`, `@vitest/coverage-v8`.
- `tsconfig.json`: drop `jest` from `types`. `tsconfig.test.json` was referenced by nothing and is deleted.
- 40 test files import from `@jest/globals`. 24 files use `jest.fn`, `jest.spyOn`, or `jest.mock` and become `vi.*`.
- `packages/cli/tests/jest.setup.ts` becomes a Vitest `setupFiles` entry.
- `docs/testing-philosophy.md`, `docs/cli-testing-guide.md`, `docs/new-command-creation-guide.md`, and `CLAUDE.md` mention Jest by name.

**Verify.**

```
npm test
npm run test:coverage
npm run typecheck
```

Coverage should still report 160 or so files under the root runner, with the cloudflare worker-side files excluded.

**Tweaks.**

## Step 2: Bump the Cloudflare test-project

**Scope.** Move `packages/cloudflare/test-project` from Vitest 3.0.9 to the same 4.x as the root. That pulls `@cloudflare/vitest-pool-workers` from 0.12 to 0.22 and wrangler from 4.37 to 4.129. The coverage provider stays Istanbul (workerd can't do V8 coverage); bump `@vitest/coverage-istanbul` to match.

Split out from step 1 because the wrangler jump is the larger change and may surface Durable Object test breakage that has nothing to do with the runner. The memory notes about `runDurableObjectAlarm` and isolated storage came from 0.12.18; recheck them against the new pool.

**Files touched.**

- `packages/cloudflare/test-project/package.json` and its lockfile.
- `packages/cloudflare/test-project/vitest.config.ts` if the pool's config shape changed.
- `packages/template-new-project/template/package.json` wrangler version, and `.positronic/wrangler.jsonc` if a newer compatibility date is wanted.
- `packages/cloudflare/CLAUDE.md` if DO testing notes change.

**Verify.**

```
cd packages/cloudflare/test-project && npm test && npm run typecheck
```

Always pass `--run` to vitest in the test-project. Without it the process watches forever.

**Tweaks.**

## Step 3: Drop SWC and let tsc emit

**Scope.** Every package builds with `tsc` for declarations and then `swc src -d dist` for JavaScript. Change each package tsconfig from `emitDeclarationOnly` to a normal emit into `dist`, delete the `swc` script, and remove `@swc/cli`, `@swc/core`, `@swc/plugin-transform-imports`, and the root `.swcrc`. The `.swc` cache directory and its gitignore line go too.

This also removes the "don't use JSX in core tests" rule from CLAUDE.md. That rule exists because the root `.swcrc` sets React as the JSX import source for the CLI's sake, and it leaks into core. With tsc emitting, each package's tsconfig owns its `jsxImportSource`.

Watch the output layout. The CLI's `postbuild` chmods `dist/src/positronic.js`, and gen-ui-components passes `--strip-leading-paths` to swc. Both depend on where swc put files. Check `bin` and `exports` in every package.json after the first build.

If bundled output turns out to matter later, tsdown is the Rolldown-based library bundler that matches what Vite does for Monocles. Not needed for this step.

**Files touched.**

- Every `packages/*/tsconfig.json` and `packages/*/package.json` (build scripts, `exports`, `bin`, `files`).
- Root `package.json` devDependencies, `.swcrc`, `.gitignore`.
- `CLAUDE.md` JSX section.

**Verify.**

```
npm run clean:workspaces && npm install && npm run build:workspaces
npm test
node packages/cli/dist/src/positronic.js --help
```

Scaffold a project with `px project new` and run `px server` against the freshly built packages.

**Tweaks.**

## Step 4: TypeScript 7 and the Monocles strictness flags

**Scope.** Bump TypeScript to 7.0.2 across the root and every package that pins its own. Keep `module: NodeNext` and `moduleResolution: nodenext` since these are published Node packages, unlike the Monocles app. Add to the root tsconfig:

- `verbatimModuleSyntax` (forces `import type`, and matches what tsc-only emit needs anyway)
- `noUnusedLocals` and `noUnusedParameters`
- `moduleDetection: force`
- `erasableSyntaxOnly`

The last one needs 11 constructors rewritten first. They use parameter properties like `constructor(private bucket: R2Bucket)` in cloudflare (9, two of them in `dev-server.ts`), core (1), and cli (1). The type-only `namespace JSX` in `packages/core/src/jsx-runtime.ts` is fine as is. These 11 rewrites are mechanical and independent, so this is the one spot where handing them to a subagent makes sense.

The build depends on `composite` project references and declaration emit. Confirm TypeScript 7 handles both in this repo before touching anything else in the step.

**Files touched.**

- Root `tsconfig.json`, `packages/core/tsconfig.check.json`.
- 11 constructor rewrites (list in the journal when the step starts).
- Whatever `noUnusedLocals` and `verbatimModuleSyntax` turn up. Expect a few dozen small edits.
- Test-project and template tsconfigs get the same flags where they apply.

**Verify.**

```
npm run typecheck
npm run build:workspaces
npm test
```

**Tweaks.**

## Step 5: React 19 and Ink 7 in the CLI

**Scope.** The CLI pins React 18.3 but ships @types/react 19, which is a mismatch waiting to bite. Ink 7 requires React 19.2. Bump react, ink, ink-text-input, and ink-testing-library together in `packages/cli`. gen-ui-components pins React 18 in devDependencies and gets the same bump. Check that react-robot's peer range covers 19 (it does as of 1.2).

Skip the React Compiler. It's a Babel plugin and there's no Babel in the build, and it buys nothing for a terminal UI.

**Files touched.**

- `packages/cli/package.json`, `packages/gen-ui-components/package.json`.
- Any Ink API changes between 5 and 7 in `packages/cli/src/components/*.tsx`. Read the Ink 6 and 7 release notes first.
- `packages/template-new-project/template/package.json` pins @types/react 18.

**Verify.**

```
npm test -- packages/cli
node packages/cli/dist/src/positronic.js brain list
```

Run a few interactive commands by hand (brain watch, the server command) since ink-testing-library doesn't cover raw-mode input.

**Tweaks.**

## Step 6: oxlint, and decide on the formatter

**Scope.** Add oxlint with the `typescript` plugin and a `lint` script. Start with the default rule set plus `no-unused-vars`, and add `react/rules-of-hooks` scoped to the CLI. Zero config beyond `.oxlintrc.json`. CLAUDE.md currently tells the agent there is no linter; update it.

Formatter is a decision for Sean. Options are Prettier 2.8 to 3.9 (smallest change, same config) or oxfmt (matches oxlint, one tool). Either way the PostToolUse hook in `.claude/settings.json` and the `format` script point at whichever wins.

**Files touched.**

- `.oxlintrc.json`, root `package.json` scripts and devDependencies.
- `.claude/settings.json` hook if the formatter changes.
- `CLAUDE.md` coding preferences section.
- Whatever the first lint run turns up.

**Verify.**

```
npm run lint
npm run format && git diff --stat
```

The format run should produce no diff if the formatter is unchanged, or one reviewable reformat commit if it changed.

**Tweaks.**

## Step 7: Dependency hygiene

**Scope.** The remaining majors-behind list. Take each one as its own small commit so a regression is easy to find.

- `@types/node` 20 and 22 to 26 everywhere. Node 24 is what's installed.
- zod 3 to 4. The `ai` package already supports 4. Check `zod-to-json-schema` in cloudflare and whether zod 4's built-in `z.toJSONSchema` can replace it.
- jose 5 to 6, dotenv 16 to 17, chokidar 3 to 5, yargs 17 to 18, eventsource.
- uuid: cloudflare pins 9, core pins 11. Node 24 and workerd both have `crypto.randomUUID`, so the package can go.
- `node-fetch` in the CLI is redundant on Node 18+.
- `nodemon` for `dev:watch` and `build:watch`. Vitest watch mode and `tsc --build --watch` cover it. Decide whether to keep the terminal-notifier wrapper.
- `@cloudflare/workers-types` is pinned to an April 2025 build in two places.

**Files touched.** package.json in root, core, cli, cloudflare, client-vercel, mem0, and the template.

**Verify.**

```
npm run dev
npm run typecheck
```

**Tweaks.**

## Leftovers noticed along the way

- `packages/cli/package.json` still depends on `@positronic/template-new-project` and `caz`, and so does cloudflare. Check whether both need it.
- `packages/spec/package.json` pins its own `typescript` and `@types/node`. Hoist to the root.
- The template's `tests/example.test.ts` fails when scaffolded. It never registers a mock response and asserts on state the example brain does not produce. Broken before the Vitest migration.
- npm 11 cannot install vitest 4.1.x (arborist crash in peer resolution). npm 12 can and needs Node 24.15+. Both are installed now. Worth an `engines` field in the template so scaffolded projects say so up front.
