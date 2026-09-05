# json-render as a replacement for gen-ui-components + the YAML page generator

**Status:** active
**Started:** 2026-09-04

## Goal

Decide whether Vercel Labs' json-render (github.com/vercel-labs/json-render)
should replace `@positronic/gen-ui-components` and the hand-rolled YAML page
generation in core. Sean's hunch: it is a better version of what
gen-ui-components is trying to be.

## Log

### 2026-09-04 — first pass

**What we have on main.** `.page({ prompt })` runs `generatePage()`: a 60-line
system prompt lists our 12 components (Zod props + description), the LLM emits
YAML, core parses it into a flat `Placement[]` (id / component / props /
parentId), and `generatePageHtml()` writes a page that loads React 18 UMD +
Tailwind play CDN from unpkg, a per-project esbuild bundle uploaded to R2 at
`bundle/components.js`, and an inline bootstrap that resolves `{{path}}`
bindings and a virtual `List` loop. Forms are native `<form method=POST>` to
`/webhooks/system/page-form`. About 2,000 lines across `core/src/yaml/` and
`core/src/ui/`, plus the package itself.

The sandbox branch (`feature/gen-ui-sandbox`, 877 commits, last touched
2026-04-22) went the other direction: give up on constrained specs, have the
LLM write real TSX, typecheck it in a Cloudflare Sandbox, screenshot it with
Browser Rendering, loop. Never wired into `prepareRunner()`.

**json-render is our architecture, done by people who kept going.** Same
shape: catalog of components (Zod props + description) → generated system
prompt → flat spec `{ root, elements: { id: { type, props, children } } }` →
renderer. Their `elements` map is our `Placement[]` with children pointers
instead of parent pointers. On top of that they have things we would have to
build next anyway:

- `validateSpec` / `autoFixSpec` (dangling children, bad visibility
  conditions, repeat without children) and `formatSpecIssues` for feeding
  errors back to the model. We have a `validate_template` tool that does a
  subset by hand.
- Expressions: `$state`, `$bindState`, `$cond/$then/$else`, `$template`,
  `$item`/`$index` with `repeat`, `$computed`. Our bootstrap has `{{path}}` and
  a hard-coded `List`.
- JSONL streaming as RFC 6902 JSON Patch lines (`createSpecStreamCompiler`).
  We already speak JSON Patch for brain state.
- 36 shadcn components (`@json-render/shadcn`) versus our 12 Tailwind divs.
- Edit modes (patch / merge / diff) for "now add X" refinement of an existing
  spec, via `buildUserPrompt({ currentSpec, editModes })`.
- `@json-render/yaml` — they even have a YAML wire format, so the
  "YAML is friendlier for the model" argument doesn't require our own parser.

Maturity: created 2026-01-14, 16k stars, v0.20.0 on 2026-08-18, commits
through 2026-08-30, 98 open issues, Apache-2.0. "Labs" means Vercel can drop
it, but the core package is small and the spec format is plain JSON we could
keep rendering ourselves.

**Where it does not line up.**

1. _zod 4._ Every json-render package peers on `zod ^4`. We are on `^3.24`
   across the monorepo. ai@6 supports zod 4, so this is a monorepo-wide bump,
   not a blocker, and it belongs in the modernization plan regardless. Zod 4
   keeps a `zod/v3` subpath if anything resists.
2. _React 19.2.3+_ for `@json-render/react`. React 19 has no UMD build, so the
   unpkg `<script>` tags go away and React gets bundled into
   `bundle/components.js`. That is a simplification (one bundle, no CDN) but
   it changes the page template and the esbuild invocation in `dev-server.ts`.
3. _Tailwind 4_ for `@json-render/shadcn`. The play CDN is Tailwind 3. Using
   the shadcn catalog means compiling CSS in the bundle step. Using
   `@json-render/core` + `@json-render/react` with our own 12 components does
   not.
4. _Form model._ json-render has no `Form` element and no native submit.
   Inputs carry `name` and `$bindState` to client state; a `Button` emits
   `press`; the app supplies an action handler. So our bootstrap registers one
   `submit` handler that reads the state store, builds `FormData`, and POSTs to
   the existing webhook. The server side (`page-form`, `parseFormData`,
   `coerceFormResponse`) does not change. `validateForm` is a built-in action
   that runs the per-field `checks`, which we get for free.
5. _`formSchema` enforcement._ Our `schema-extractor` walks the YAML tree to
   prove the form will produce the fields the brain expects. The spec is still
   a tree, so that logic ports; it just reads `elements` instead of
   `ComponentNode`. Worth keeping as a custom validator run alongside
   `validateSpec`.
6. _Streaming buys nothing today._ Pages are generated once, stored via
   `pages.create()`, and served later. Progressive rendering only matters if a
   browser is watching during generation. Use `generateText` + `validateSpec`
   first; streaming is available if `.page()` ever renders live.

**What we considered.** Keep the sandbox/TSX branch alive as the real fix.
It has a higher quality ceiling, but it needs Sandbox + Browser Rendering
bindings in every project, costs a screenshot loop per page, and the
Cloudflare integration was never finished. json-render is the cheaper bet:
keep the constrained spec, make the spec and the component library good.
The honest caveat is that "YAML produces crappy results" was partly the
60-line prompt and 12 components, not the spec approach itself; json-render's
prompt, rules, examples, and 36 components are a much better starting point,
but it is still a constrained-spec system.

**Proposed order, if we go.**

1. zod 3 → 4 across the monorepo (prerequisite, standalone PR).
2. Replace `core/src/yaml/` and `core/src/ui/generate-page.ts` with a
   `defineCatalog` built from the existing `UIComponent` records (props +
   description map 1:1), `catalog.prompt()`, `generateText`, then
   `validateSpec` + `autoFixSpec` + the ported formSchema check. Render with
   `@json-render/react`'s `Renderer` inside the existing bundle. Net deletion
   of roughly 1,500 lines in core.
3. Swap our 12 components for `@json-render/shadcn` once the bundle compiles
   Tailwind 4 CSS.

### 2026-09-05 — plan of attack

Sean decided: redo gen-ui-components on json-render. The plan is in
`docs/json-render-plan.md` (same shape as the modernization plan: four
steps, Tweaks lines, decisions, risks). What was learned turning the
evaluation into a plan:

**zod 4 really is first, but for a narrower reason than "peer dep".**
json-render's prop introspection handles zod 3 and 4 (`_def.typeName` vs
`_def.type`), so the prompt would work on zod 3. `catalog.validate()` would
not: it composes our `props` schemas into a zod 4 union, and zod 3 instances
inside a zod 4 schema fail. The bump is small outside the code this plan
deletes: nine uses of `z.AnyZodObject` / `z.ZodTypeAny` in three files,
`coerceFormResponse`'s `_def.typeName` check, and `zod-to-json-schema` in
cloudflare. zod 3.25.76 is already installed (it ships `zod/v4`), so the
delta is mostly types.

**Define our own schema rather than reuse `@json-render/react/schema`.**
The React schema's `defaultRules` tell the model to invent realistic sample
data and put it in `/state`. Our `.page({ props })` pre-seeds state with real
data and wants the model to only reference it. Fighting baked-in rules with
`customRules` is the wrong move; `defineSchema` takes `defaultRules` and
`builtInActions`, and the React `Renderer` only cares about the spec shape,
so a Positronic schema with the same shape and our rules is about 40 lines.

**Forms: keep the server, change the client.** json-render has no `Form`
element and no native submit; inputs `$bindState` into client state and
buttons emit `press`. So the bundle owns one `submitForm` action handler
that reads `/form`, builds `FormData` (arrays append per item so
`parseFormData` is unchanged), and POSTs to the existing `page-form`
webhook URL with the CSRF token. `validateForm` is built in and their
action provider is written so `[validateForm, submitForm]` in sequence sees
the validation result. The `formSchema` check ports from walking YAML to
walking `elements` for `$bindState` paths under `/form/`.

**Core loses React entirely.** The only React import in core was
`ComponentType` in `ui/types.ts`. With the catalog (zod only) in core and
the registry (React) in the browser bundle, core depends on
`@json-render/core` and nothing UI-side. `@json-render/core`'s only
dependency is zod and it has no `node:` imports, so it should run in the
brain-runner Durable Object; that is the first thing to confirm in step 1.

**React 19 forces the bundle change anyway.** `@json-render/react` peers on
React 19.2, which has no UMD build, so the unpkg script tags go and React
ships inside `bundle/components.js`. That in turn removes the inline
bootstrap. `@json-render/shadcn` uses Tailwind utility classes with shadcn
CSS variables and ships no CSS, so the project needs a Tailwind 4 build
step (`@tailwindcss/cli` with `@source` pointing at shadcn's dist and
`src/components`) producing `bundle/components.css`. Precompiling CSS inside
gen-ui-components was considered and rejected: a project's custom
components would have no styles.

**Noticed along the way.** The template's `brain-dsl-guide.md` section on
`withComponents()` documents a `render:` function returning HTML strings.
That API never existed on main; the section gets rewritten in step 3
regardless.
