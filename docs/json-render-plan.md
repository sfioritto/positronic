# json-render plan

**Status:** step 1 implemented (uncommitted), steps 2–3 pending
**Started:** 2026-09-05
**Evaluation:** `docs/journal/2026-09-04-json-render-evaluation.md`

Rebuild page generation on Vercel Labs' json-render. Core stops owning a spec format, a prompt, a validator, and a browser runtime; it depends on `@json-render/core` for those and produces a json-render `Spec`. `@positronic/gen-ui-components` is rewritten from twelve Tailwind divs into a Positronic catalog built on `@json-render/shadcn`, plus the browser bundle that renders it. The server side of forms (the `page-form` webhook, `parseFormData`, `coerceFormResponse`, brain suspension) does not change.

Steps are ordered by dependency. Step 0 already shipped with the modernization work. Each step ends with a green `npm run dev` and `npm run typecheck`, a code review pass, and a commit Sean approves. Step 0 is a standalone PR. Steps 1 through 3 could be one PR or three; they are not independently shippable because the template must match core.

Each step has a **Tweaks** line for Sean to fill in before work starts.

## Where things stand

| Concern              | Today                                                            | After                                                                 |
| -------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Spec format          | Our YAML → `ComponentNode` → flat `Placement[]` with `parentId`  | json-render `Spec` (`root` + `elements` map + `state`)                |
| Prompt               | 60-line hand-written system prompt in `generate-page.ts`         | `catalog.prompt()` from core's `pageSchema` prompt template           |
| Validation           | `validate_template` tool, hand-rolled in core/yaml               | `autoFixSpec` + `validateSpec` + `catalog.validate` + ported form check |
| Data bindings        | `{{path}}` strings resolved by an inline bootstrap               | `$state` / `repeat` / `$item` JSON-pointer expressions                |
| Forms                | Native `<form method=POST>`                                      | Inputs bound to `/form/*` state; `submitForm` action POSTs FormData   |
| Components           | 12 in gen-ui-components, React 19 peer, Tailwind 3 play CDN      | ~20 shadcn components + 2 Positronic extras, React 19, Tailwind 4     |
| Browser runtime      | React 18 UMD from unpkg + inline bootstrap + `bundle/components.js` (broken: bare `require("react/jsx-runtime")`) | One self-contained `bundle/components.js` + `bundle/components.css` |
| zod                  | 4.5 everywhere (modernization step 7, 2026-09-05)                | unchanged; json-render peers on `zod ^4`                              |
| Core's React import  | `ComponentType` in `ui/types.ts`                                 | none                                                                  |

Lines that go away: `core/src/yaml/` (about 1,050), `core/src/ui/generate-page.ts` (513), the bootstrap in `generate-page-html.ts` (about 150), and `gen-ui-components/src/components/` (about 530). Lines that arrive: roughly 400 in core and 300 in gen-ui-components.

## Step 0: zod 3 to 4 across the monorepo

**Done 2026-09-05** as modernization step 7 (commit e7ea9995), before this plan started. Kept here for the record of why it had to come first.

**Scope.** `@json-render/core` declares `zod ^4` as a peer and builds its `catalog.validate()` schema by composing our component `props` schemas into a zod 4 union. Mixing zod 3 instances into that fails, and `formSchema` from `.page()` crosses into the same code. So the bump comes first, as its own PR. This is item 2 of modernization step 7 pulled forward.

Zod 4 drops `z.AnyZodObject` and `z.ZodTypeAny`. Outside the directories this plan deletes, there are nine uses: `core/src/clients/types.ts`, `client-vercel/src/index.ts`, `cloudflare/src/token-estimator.ts`. Replace with `z.ZodObject` and `z.ZodType`. Check whether `z.ZodSchema` (30 uses) survives as an alias; if not, it becomes `z.ZodType`. `coerceFormResponse` inspects `_def.typeName`; zod 4 uses `_def.type` with lowercase names, so that helper changes (or moves to `instanceof` now that `zod/v4` is one package). Replace `zod-to-json-schema` in cloudflare with `z.toJSONSchema`. `ai@6` and `@ai-sdk/google` already accept zod 4.

**Files touched.** package.json in core, cloudflare, client-vercel, mem0, gen-ui-components, the template, and the cloudflare test-project. The three source files above plus `cloudflare/src/api/brains.ts`. Any test that constructs schemas with removed aliases.

**Verify.**

```
npm run dev
npm run typecheck
cd packages/cloudflare/test-project && npx vitest --run
```

**Tweaks.**

## Step 1: Core generates and embeds a json-render Spec

**Implemented 2026-09-05**; see `docs/journal/2026-09-05-json-render-step-1-core-spec.md`. Deviations from the scope below: core owns the json-render schema and prompt template (`pageSchema`, `definePageCatalog`) because json-render's default prompt template, not just its rules, tells the model to invent sample state; `catalog.validate` turned out to check component names only, so the form check reads bound prop types from the catalog's Zod schemas; the `$state` path walker was skipped; `FormSchema`/`isFormSchema` were dead code and deleted; gen-ui-components carries a local `UIComponent` type until step 2 so the build stays green.

**Scope.** Replace `core/src/ui/generate-page.ts` and all of `core/src/yaml/` with a generator built on `@json-render/core`. Keep `describeDataShape` from `yaml/type-inference.ts`; it is what tells the model the shape of `props` without leaking the values, and json-render has no equivalent (its `buildUserPrompt` dumps the state itself).

The generation loop becomes: build the system prompt with `catalog.prompt({ customRules })`; build the user prompt from the step's `prompt`, the `props` shape, and the expected form fields; call `client.generateText` once; compile the JSONL with `compileSpecStream`; seed `spec.state` with `props` (props win over anything the model wrote at the same keys); `autoFixSpec`; then `validateSpec`, `catalog.validate` (prop types, unknown components), and a ported form-schema check. On errors, one or two repair rounds: `buildUserPrompt({ prompt: formatSpecIssues(issues), currentSpec, editModes: ['merge'] })`, compile the returned patches onto the current spec, re-validate. This replaces the `validate_template` tool and the `maxSteps` tool loop.

The form-schema check ports `yaml/schema-extractor.ts` to walk `spec.elements`: an input's field name is the last segment of its `$bindState` path under `/form/`, its type comes from the component and its `type` prop (number Input → number, Checkbox → boolean, Select/Radio → enum, Checkbox inside a `repeat` → array). Compared against `formSchema` the same way as today. `yaml/data-validator.ts` is not ported; seeding `spec.state` before `validateSpec` lets json-render's own `repeat_state_mismatch` check cover the array cases, and `$state` paths against real data are checked by a 20-line walker.

`generate-page-html.ts` shrinks to: a `<title>`, `<link href="/bundle/components.css">`, `<script src="/bundle/components.js">`, and one inline script that sets `window.__POSITRONIC_PAGE__ = { spec, formAction }` and calls `PositronicPage.mount(document.getElementById('root'))`. No unpkg, no Tailwind CDN, no bootstrap.

The DSL: `withComponents(components)` becomes `withCatalog(catalog)` where `catalog` is a json-render `Catalog`. `createBrain({ components })` becomes `createBrain({ catalog })`. `StepContext.components` becomes `catalog`. The `generatePage` tool reads `context.catalog`; the prompt-loop enrichment in `event-stream.ts` (lines 843 to 855) lists `catalog.componentNames`. `UIComponent`, `Placement`, and `mergeComponents` leave the public API. Core exports a `PageCatalog` type alias and re-exports `defineCatalog` so projects don't need a direct `@json-render/core` import.

Core keeps no React dependency.

**Files touched.**

- Delete `core/src/yaml/*` except `type-inference.ts` (moves to `core/src/page/describe-data.ts`). Delete `core/src/ui/generate-page.ts`, `core/src/ui/component-utils.ts`, `core/src/ui/types.ts` (keep `FormSchema`, `isFormSchema`, `parseFormData`, `coerceFormResponse`, `generateFormToken`).
- New `core/src/page/generate-spec.ts`, `core/src/page/form-schema-check.ts`, `core/src/page/page-html.ts`.
- `core/src/dsl/builder/brain.ts`, `core/src/dsl/create-brain.ts`, `core/src/dsl/types.ts`, `core/src/dsl/definitions/blocks.ts`, `core/src/dsl/execution/event-stream.ts` (`executePageStep`), `core/src/tools/index.ts` (`generatePage` tool), `core/src/index.ts`.
- Tests: `core/tests/generate-page.test.ts` (795 lines, all YAML; rewrite around JSONL in, `Spec` out, repair loop, form check, props seeding), `core/tests/generate-page-html.test.ts`, `core/tests/brain-ui.test.ts` (mock output changes from YAML to JSONL; the suspension and form-merge tests survive as-is), `core/tests/brain-prompt-loop.test.ts`.
- `core/package.json`: add `@json-render/core`, drop `uuid` and `@types/react` if nothing else uses them.

**Verify.**

```
npm run dev
npm run typecheck
```

**Tweaks.**

## Step 2: Rewrite `@positronic/gen-ui-components`

**Scope.** The package keeps its name and becomes the Positronic catalog and browser runtime, in three entry points.

`@positronic/gen-ui-components/catalog` is server-safe (no React). It exports:

- `components` and `actions` definitions, and `catalog = definePageCatalog({ components, actions })` using core's `pageSchema` (step 1 moved the schema and prompt template into core; the package no longer defines its own). Components are picked from `shadcnComponentDefinitions` (Card, Stack, Grid, Separator, Heading, Text, Badge, Alert, Table, Input, Textarea, Select, Checkbox, Radio, Switch, Button, Link) plus two Positronic definitions: `Hidden` (a seeded form value the user never sees, replaces `HiddenInput`) and `MultiTextInput` (array of strings, no shadcn equivalent). Overlays (Dialog, Drawer, Popover, Tooltip, DropdownMenu, Carousel) are left out to keep the prompt short; adding one later is a one-line change.
- `defineComponents`/`extendCatalog` helper so a project can add its own component definitions without re-listing ours.

`@positronic/gen-ui-components` (root) is browser-only. It exports `registry` (`defineRegistry(catalog, { components: shadcnComponents subset + our two, actions: { submitForm } })`) and `mount(rootEl)`, which reads `window.__POSITRONIC_PAGE__`, renders `JSONUIProvider` + `Renderer` with `initialState: spec.state`, and installs the `submitForm` handler. That handler checks `/formValidation/valid`, builds `FormData` from `/form` (arrays append one entry per item, so `parseFormData` sees them as today), POSTs to `formAction`, and sets `/submitted` so the page can show a confirmation. This keeps the `page-form` webhook and the CSRF token flow untouched.

`@positronic/gen-ui-components/theme.css`: the shadcn CSS variables (neutral base color, matching their `components.json`) for the project's Tailwind entry to import.

Dependencies: `@json-render/core`, `@json-render/react`, `@json-render/shadcn`, `react` and `react-dom` 19, `zod` 4. `tailwindcss` 4 is a peer for the consuming project. The CLI still pins React 18.3 for Ink 5, so npm nests one copy; modernization step 5 resolves that. Pin json-render to an exact version; it is a labs project at 0.20 with deprecations already visible in its API.

Tests: the package has none today. Add two cheap ones: every key in `catalog` has a matching key in `registry`, and `catalog.prompt()` mentions `submitForm` and `/form/`. A jsdom render test of `mount` with a two-field spec is worth it if it stays under 50 lines.

**Files touched.** Everything under `packages/gen-ui-components/src/`. `package.json` gains `exports` for `./catalog` and `./theme.css` and switches to React 19 types. The build still runs tsc + swc; check the root `.swcrc` automatic runtime is fine for React 19 (it is).

**Verify.**

```
npm run dev
npm run typecheck
```

**Tweaks.**

## Step 3: Cloudflare bundle build and the project template

**Scope.** This step also closes the modernization step 7 leftover: the component bundle in a fresh project has bare `require("react/jsx-runtime")` calls because gen-ui-components compiles with `jsx: react-jsx` and esbuild's `external: ['react']` externalises `react/jsx-runtime` too, inside an IIFE that has no `require`. Removing the externals is the fix, and React 19 (no UMD build) plus `@json-render/react`'s React 19 peer make it the only option.

The dev server's `buildAndUploadBundle` builds two files. JavaScript: esbuild on `.positronic/bundle.ts` with no externals (React 19 has no UMD build, so it ships inside the bundle), `--format=iife`, `--jsx=automatic`, minified. CSS: `npx @tailwindcss/cli -i .positronic/styles.css -o .positronic/dist/components.css`. Both go to R2 under `bundle/`; `api/bundle.ts` serves `components.css` next to `components.js` with the same no-auth rule in `api/index.ts`. The spec test in `packages/spec/src/api/bundle.ts` and its use in the test-project's `spec.test.ts` gain the CSS case.

The template changes accordingly: `.positronic/bundle.ts` becomes `import { mount } from '@positronic/gen-ui-components'; import '../src/components/index.js'; mount(document.getElementById('root')!)`; `.positronic/styles.css` is `@import "tailwindcss"; @import "@positronic/gen-ui-components/theme.css"; @source "../node_modules/@json-render/shadcn/dist"; @source "../src/components";`; `.positronic/esbuild.config.mjs` matches the dev server's flags; `src/components/index.ts` exports `catalog` (and `registry`) built from gen-ui's helpers with a commented example of adding a custom component to both; `src/brain.ts` passes `catalog` to `createBrain`. `package.json` adds `tailwindcss` and `@tailwindcss/cli` to devDependencies, `react` and `react-dom` 19 to dependencies, and bumps `@types/react`; `@json-render/shadcn` arrives transitively through gen-ui-components.

`packages/template-new-project/src/index.ts` keeps its gen-ui version lockstep logic unchanged.

Docs in the template: the `withComponents()` section of `docs/brain-dsl-guide.md` is already wrong (it shows a `render:` function returning HTML strings that never existed); rewrite it for `withCatalog`. Update the page-step and `generatePage` sections and `docs/tips-for-agents.md`. Update CLAUDE.md's gen-ui notes in this repo.

No automated test exercises a scaffolded project, so this step ends with a manual run: `px project new`, `px server`, run the `hello` brain, open the page, submit the form, confirm the brain resumes with the field on state. Also confirm the dev server's file watcher (which rebuilds on `src/components/` changes) still triggers the CSS build.

**Files touched.** `cloudflare/src/dev-server.ts`, `cloudflare/src/api/bundle.ts`, `cloudflare/src/api/index.ts`, `spec/src/api/bundle.ts`, `cloudflare/test-project/tests/spec.test.ts`, everything listed under the template above, `CLAUDE.md`.

**Verify.**

```
npm run dev
npm run typecheck
cd packages/cloudflare/test-project && npx vitest --run
```

plus the manual scaffold run.

**Tweaks.**

## Decisions for Sean

1. **`withCatalog` versus keeping `withComponents`.** The value is a json-render `Catalog` and the React implementations no longer pass through core, so the old name misdescribes it. Recommendation: rename.
2. **Initial shadcn subset.** The 17 listed above, or all 36. Recommendation: the subset; every extra component is prompt tokens on every page.
3. **Repair rounds.** One or two before failing the step. Recommendation: two, and log each round's issues so we can see how often the model needs them.
4. **Structured output instead of JSONL.** `catalog.jsonSchema()` exists and `generateObject` would guarantee shape. json-render's prompt and rules are written for JSONL patches, and the Gemini client's structured output has been the flakier path in this repo. Recommendation: JSONL for now, revisit if repair rounds are frequent.

## Risks

- **json-render churn.** Labs project, v0.20, 98 open issues, deprecated option names already in the code. Pin exact versions. If it is abandoned, the spec format is plain JSON and `@json-render/core` is small enough to fork.
- **workerd compatibility.** `@json-render/core` runs inside the brain-runner Durable Object. Its only dependency is zod and it has no `node:` imports, so this should be fine; verify in the test-project early in step 1.
- **Prompt quality is still a constrained-spec system.** The evaluation was honest that our poor results came partly from the 60-line prompt and 12 components. This is a much better starting point, not TSX-in-a-sandbox. Keep the `feature/gen-ui-sandbox` branch around as the fallback design.
- **Bundle size.** shadcn plus Radix plus React 19 is likely several hundred KB minified. Served once from R2 per page load; acceptable, but measure it in step 3.
- **Validation timing.** `submitForm` relies on `validateForm` having written `/formValidation` first. json-render's action provider is written for exactly that sequence (see the comment in `contexts/actions.tsx`), but test it in the jsdom test.

## Out of scope for now

- Streaming a page as it generates. Pages are created once and served later; nothing is watching. `createSpecStreamCompiler` is there when that changes.
- Edit mode ("now add a phone field to this page"). `buildUserPrompt({ currentSpec })` makes it cheap later; no DSL surface for it yet.
- `@json-render/yaml`. The JSONL default is what their prompt is tuned for.
- The React 19 bump in the CLI (modernization step 5) and the rest of modernization step 7.
