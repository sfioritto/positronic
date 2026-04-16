# Generative UI: From YAML to React via Sandbox

**Status:** active
**Started:** 2026-03-30

## Goal

Replace the YAML-based page generation in `.page()` with real React/TSX generation backed by Cloudflare Sandbox (type checking, bundling) and Browser Rendering (visual screenshots). The LLM should be able to see what it builds and iterate until it's satisfied.

The deeper motivation: this is the foundation for Positronic Surface — a standalone service where agents send a prompt and get back a hosted page URL. The template/data separation (LLM generates a reusable component, actual data merges client-side in the browser) is the core architectural insight that makes this viable as a product. The LLM never sees user data. Pages are cheap to serve because the template is a static asset and data binding happens in the browser.

## Why the current approach fails

The current `.page()` step generates UI through a YAML-based LLM loop. The LLM describes a component tree in YAML, a `validate_template` tool checks if the YAML parses and bindings resolve, and the result gets converted to a flat placement array that a browser-side bootstrap runtime renders into React components.

This produces mediocre results for three reasons:

1. **The LLM generates blind.** It never sees the rendered page. It can't tell if the layout is cramped, if the spacing is wrong, if the visual hierarchy doesn't work. It's writing UI by description alone.

2. **No type safety.** The YAML DSL has its own validation (component names, binding paths, form schema matching) but none of it catches the real errors — wrong prop types, missing required props, impossible component compositions. The validation is structural, not semantic.

3. **The YAML DSL is an expressiveness ceiling.** You can describe a component tree but you can't express conditional rendering, computed values, or complex layouts. Every page has to fit into the "flat tree of components with data bindings" model. Real React removes this ceiling entirely.

## Why this particular approach

### Cloudflare Sandbox + Browser Rendering

Cloudflare ships two services that fit this use case almost perfectly:

**Sandbox SDK** gives you a persistent Linux container accessible from Workers. You can write files, execute commands, and manage sessions — all via a JavaScript API. One sandbox per project stays warm (10-minute idle timeout, state persists across sleep/wake). Sessions within a sandbox provide isolation for concurrent operations. This means: write TSX into the sandbox, run `tsc --noEmit` to type-check, run `esbuild` to bundle. The sandbox has the full Node.js toolchain.

**Browser Rendering API** takes raw HTML and returns a PNG screenshot. No deployment needed — you POST HTML, you get an image. This means: wrap the bundled component in an HTML shell with React CDN + Tailwind CDN + fake data, screenshot it, send the image back to the LLM as a tool result.

The combination gives the LLM a proper feedback loop: write code, see type errors, fix them, see the rendered result, adjust styling, submit when satisfied.

### Why not run this locally?

These services don't have local equivalents in `wrangler dev`. Sandbox and Browser Rendering are Cloudflare network services. `wrangler dev --remote` works (your Worker runs locally but hits real Cloudflare services), but pure local dev won't have page generation. This is an acceptable tradeoff — the feature is a cloud capability, and the value proposition of Surface as a product is precisely that you don't run your own infrastructure.

### Template/data separation

The LLM generates a React component that receives a typed `data` prop. At render time, actual data is injected via `window.__POSITRONIC_DATA__` and the component renders it. The LLM only ever sees the _shape_ of the data (a TypeScript interface), never the actual values. This is what makes the approach privacy-safe and what enables the Surface product model — you host the template, the data comes from elsewhere.

### The generation loop

The LLM calls tools in a loop: `write_component` (writes TSX, runs tsc), `preview` (bundles, screenshots), `submit` (finalizes). This uses `streamText` with auto-execute — the tools carry their own state via closures (step count, last written component). If the LLM hits the step limit without calling submit, the last written component is used as fallback.

We considered a manual `generateText` loop to yield progress events to the brain event stream, but decided against it. Page generation is a tool for agents to call, not a step that needs real-time progress visibility. If we need debugging visibility later, that's a logging/inspection concern, not an event stream concern. Using `streamText` keeps the implementation simpler.

### Multi-modal tool results

The `preview` tool returns a screenshot PNG that the LLM needs to _see_, not read as a base64 string. This required adding `ContentBlock` types to the `ObjectGenerator` interface — a union of `{ type: 'text' }` and `{ type: 'image' }` blocks. Each client implementation (Anthropic, Vercel) converts these to its provider's native format. Anthropic natively supports image blocks in tool results. The Vercel AI SDK uses a `{ type: 'content', value: [{ type: 'file-data', ... }] }` format.

### Component library: shadcn, not custom

The existing `gen-ui-components` package has 12 hand-built components with Zod prop schemas, designed for the YAML generation approach. We're replacing it with `page-components` — ~28 components wrapping shadcn/ui with constrained props.

Why shadcn: it's built on Tailwind (which we already use), it's "AI-ready" (their words — they ship a SKILL.md with composition rules and best practices for LLMs), and it's copy-paste (you vendor the source, not install a dependency), which means we control the API surface. The LLM doesn't see raw shadcn — it sees our wrapper components with simplified props.

The design system document (adapted from shadcn's SKILL.md) ships in the package and gets injected into the system prompt. It tells the LLM how to compose components, what spacing to use, when to use Card vs Tabs, and what not to do. This is what turns "components exist" into "pages look good."

### No more `withComponents()` or `UIComponent`

The current system threads a `Record<string, UIComponent>` through the brain at runtime — `createBrain({ components })`, `brain.withComponents()`, passed through event-stream, used by the YAML generator and the prompt loop tool enrichment. Each `UIComponent` carries a React component, a description string, and a Zod prop schema.

All of this goes away. In the new model, the sandbox filesystem IS the component registry. User-defined components live in the project's `components/` directory, get bundled at build time alongside `page-components`, and the LLM discovers them via `.d.ts` type declarations. No runtime component records, no Zod prop schemas, no `withComponents()`. The build pipeline (which already exists) handles everything.

This simplifies core significantly — removes the `UIComponent` interface, the components field on Brain, the threading through event-stream, and the tool enrichment that appends component lists to the `generatePage` tool description.

### `Pages` interface: generation + storage

Rather than a separate `PageGenerationProvider`, the generation capability merges into the existing `Pages` interface (recently renamed from `PagesService`). The interface gains an optional `generate` method alongside `create`/`get`/`update`. This is internal plumbing — brain authors never see it. They call `.page()` in the DSL and the framework handles the rest.

In Cloudflare's `prepareRunner()`, the pages service is auto-wired with sandbox and browser rendering bindings. No user configuration needed. The only user-facing addition is `pages: { client }` on `createBrain()` for optionally using a different (cheaper/faster) model for page generation.

### Client interface cleanup

We identified that `createToolResultMessage` on `ObjectGenerator` is a leaky abstraction. It exists because `responseMessages` is opaque (`unknown[]`), forcing the caller to use a factory method to construct tool results in the provider's native format. The right design: the client defines typed message interfaces, the caller constructs messages to match, and the client converts internally. `ToolMessage` already has the right shape for this. This is a future cleanup — it doesn't block the page generation work, but it's the direction the interface should go.

## Log

### 2026-03-30: Design session

Extensive design discussion covering the full architecture. Key decisions made:

- Cloudflare Sandbox + Browser Rendering for the feedback loop
- `Pages` interface owns both storage and generation
- Auto-wired in `prepareRunner()`, no user config needed
- shadcn component library with design system doc
- `withComponents()` and `UIComponent` go away entirely
- Template/data separation as the core architectural pattern
- 7-phase implementation plan approved

### 2026-03-30: Phase 1 implementation

Added `ContentBlock` types to core, `isContentBlockArray` type guard, `imageContent` helper. Updated both client packages — extracted `toAnthropicToolContent` and `toVercelToolOutput` helpers for clean content block conversion. All 205 tests pass.

### 2026-03-31: Design refinement

Revisited the generation loop approach. Originally planned a manual `generateText` loop with remaining-step warnings injected as messages. Reconsidered in favor of `streamText` with closures — simpler, the warnings go in tool results, and we don't need event stream visibility for page generation. The generation tool is something agents call, not a step that needs real-time progress updates.

Also identified that `createToolResultMessage` shouldn't be on the public interface. The `ToolMessage` type already has the right shape for tool results — the caller should construct typed messages and the client should convert internally. Punting this cleanup but noting it as the right direction.

## Learnings

- Cloudflare Sandbox SDK uses Durable Objects under the hood. Sandbox state persists across sleep/wake cycles. Sessions within a sandbox provide isolation for concurrent operations. One sandbox per project, one session per generation call.

- Browser Rendering REST API accepts raw HTML directly via an `html` field — no deployment or URL needed. Returns binary PNG. This makes the screenshot step trivial.

- The Vercel AI SDK supports multi-modal tool results via `{ type: 'content', value: [{ type: 'file-data', data, mediaType }] }` on `ToolResultOutput`. The Anthropic SDK supports `{ type: 'image', source: { type: 'base64', media_type, data } }` in `ToolResultBlockParam.content`.

- shadcn ships an AI skill document (SKILL.md) with composition rules, styling guidance, and a component selection matrix. This is the base for our design system document — we're adapting it, not writing from scratch.

- `yield*` with an async generator forwards all yielded values and captures the return value. Useful pattern for composing generators, though we ended up not needing it.

- The `responseMessages` opacity on `ObjectGenerator` is the root cause of `createToolResultMessage` existing. Making `generateText` accept typed `ToolMessage[]` throughout (with the client converting internally) would eliminate the factory method entirely.

- The core JSX renderer (`renderNode` in `render.ts`) throws on HTML intrinsic elements — it's designed for prompt text, not markup. JSX in `.prompt()` templates works because it uses Fragment and string children only, not HTML tags.

- JSX compilers (SWC, Babel, esbuild) all collapse whitespace in text content — newlines become spaces. This is a fundamental JSX behavior, not a tooling bug. The project already has an esbuild plugin for whitespace preservation in generated projects' brain builds, but it only works with esbuild.

- npm workspace scripts run from the monorepo root, not the package directory. Use `require.resolve('./package.json')` to reliably locate the package directory in build scripts.

- Cloudflare text blob bindings and Workers Assets are great for Worker-owned files but don't work for npm library packages — the consumer would need to configure their `wrangler.toml` to point at files inside `node_modules`.

## Dead ends

### Manual `generateText` loop for page generation

We planned to use `generateText` in a hand-rolled loop so we could inject remaining-step warnings as user messages and yield brain events for progress visibility. We designed the loop, the tool definitions, and the event types.

Abandoned because: (1) remaining-step warnings work fine as part of tool results rather than injected messages, (2) page generation doesn't need event stream visibility — it's a tool agents call, not a step that streams progress, (3) `streamText` handles the loop automatically and is simpler. The manual loop adds complexity for a capability (progress events) we don't need yet. If we need it later for debugging, it's a logging concern, not an event stream concern.

### `withComponents()` runtime component threading

The existing pattern threads `UIComponent` records through `createBrain` → `Brain` → `BrainRunner` → `BrainEventStream` → `generatePage()`. Each component carries a React component, a description, and a Zod prop schema.

Not exactly a dead end (it works today for YAML generation), but it's being removed entirely. The insight: in a world where the LLM writes real TypeScript against real type declarations in a sandbox, runtime component metadata is redundant. The sandbox filesystem replaces the component registry, TypeScript types replace Zod schemas, and JSDoc/type names replace description strings. The build pipeline handles everything at build time.

### 2026-04-02: Surface build and plugin architecture session

#### Build: esbuild → SWC

The surface package was the only package using esbuild for its build. The sole reason: one `import systemPromptTemplate from './system-prompt.md'` that needed esbuild's text loader. With `packages: 'external'`, esbuild wasn't even bundling dependencies — it was just inlining that one markdown file.

We explored several alternatives before landing on a prebuild codegen step:

**JSX approach** — Write the system prompt as JSX using the core `@positronic/core` JSX runtime. Dead end because: (1) the core renderer throws on HTML intrinsic elements (`<h1>`, `<p>`, etc.) — it only supports Fragment, File, Resource, Form, and function components, and (2) even with just Fragments and string children, the JSX compiler (SWC or otherwise) collapses newlines in text content to spaces, which would destroy the markdown formatting. The project already has an esbuild whitespace preservation plugin for exactly this reason in generated projects, but that would just bring esbuild back.

**Runtime `fs.readFileSync`** — Can't work. No filesystem on Cloudflare Workers.

**Cloudflare text blob bindings** — `[[text_blobs]]` in `wrangler.toml` would let wrangler inline the file at deploy time, keeping SWC happy. But surface is an npm library package, not a Worker. The `.md` file lives in `node_modules/`. Consumers would need to configure their own `wrangler.toml` to point at a file inside `node_modules` — leaking an implementation detail.

**Cloudflare Workers Assets** — Same problem. The consumer would need to copy the `.md` into their assets directory.

**Fetch from hosted URL** — The system prompt could live on a server and be fetched at runtime. Viable but adds a network dependency for self-hosted users.

**Winner: prebuild codegen** — A one-liner in package.json's `prebuild` script reads the `.md` and writes a `.gen.ts` that exports the content as a `JSON.stringify`'d string. The `.gen.ts` is gitignored. The `.md` stays the source of truth, readable and editable. SWC handles the generated `.ts` like any other file. Boring but self-contained — consumers just `npm install` and it works.

One gotcha: npm workspace scripts run from the monorepo root, not the package directory. Had to use `require.resolve('./package.json')` to locate the package directory reliably.

#### Plugin architecture: Surface as a product

This session also refined the vision for how surface fits into Positronic long-term. Key decisions:

**Remove `prompt` from `.page()`** — The `.page()` step should only accept `html`. No built-in AI generation. If you want generated UI, you use the surface plugin explicitly. This keeps `.page()` simple and framework-agnostic.

**Surface as a plugin with two modes:**

```typescript
// Self-hosted: bring your own Cloudflare infrastructure
surface.setup({
  client: fastModel,
  sandbox: env.SANDBOX,
  accountId: env.CF_ACCOUNT_ID,
  apiToken: env.CF_API_TOKEN,
});

// Hosted service: just an API token, works on any platform
surface.setup({
  token: 'pos_xxxx',
});
```

Self-hosted requires Cloudflare (sandbox DO + browser rendering). Hosted service handles everything server-side — no Cloudflare dependency, no client/model config needed.

**Usage in page steps:**

```typescript
.page('Dashboard', async ({ surface, state }) => ({
  html: await surface.generate({ prompt: '...', inputSchema: '...' }),
}))
```

No separate `.step()` needed — the plugin is on the page step context, call `generate()` directly.

**Generated projects** — When `px project new` scaffolds a Cloudflare project, the template includes the surface plugin pre-wired. Non-Cloudflare projects don't get it. Hosted service mode would work for any backend.

**Why this matters for the product vision** — The user wants surface to be both open source (self-host on Cloudflare) and a paid product (hosted API). The plugin pattern supports both: same DSL, same brain code, different setup config. The framework has zero knowledge of surface — it's just a plugin that happens to generate HTML.

### 2026-04-16: Reversing "remove prompt from .page()" — generation is first-class

We initially removed `prompt` from `.page()` (2026-04-02) to keep the DSL simple and push generation into explicit `context.surface.generate()` calls. After using it, that decision doesn't hold up. Page generation is the primary use case for `.page()` — making users manually call surface in every page configFn is ceremony that should be framework-handled.

**The new API:**

```typescript
.page('Dashboard', ({ state: { metrics, alerts } }) => ({
  message: `Show a metrics dashboard with KPIs and alert banner`,
  data: { metrics, alerts },
  formSchema: z.object({ selectedMetrics: z.array(z.string()) }),
}))
```

Key design decisions:

1. **`message` not `prompt`** — Consistent with `.prompt()` and `.map()` which use `message` for the LLM instruction. The old API used `prompt` which was inconsistent.

2. **`data` not `props`** — The brain author wraps their state fields in an object: `data: { emails }`. The field names carry semantic signal for fake data generation. Surface never sees the real values — only the inferred TypeScript interface. The old `props` name was ambiguous (React props? function params?).

3. **`system` optional** — Appended to the user prompt as additional context, doesn't replace surface's 845-line system prompt. For domain-specific guidance like "use conservative colors for financial data."

4. **Runtime inference, not Zod input schema** — We considered requiring a Zod schema for `inputSchema` (consistent with `outputSchema` on `.prompt()`). Decided against it — the brain author already has the data, requiring them to also define its schema is redundant. We infer the TypeScript interface string from the runtime values. Field names are the semantic signal. Edge case: empty arrays produce `unknown[]` — docs should guide users to include at least one item.

5. **`formSchema` stays, not `outputSchema`** — The field controls form/webhook/auto-merge behavior, not just output shape. Keeping the name distinct from `.prompt()`'s `outputSchema` is intentional — it does more.

**Under the hood:** `executePageStep` detects `message` vs `html`, looks up `this.pluginInjections.surface?.generate`, converts data → TS interface string, formSchema → TS interface string, calls generate, swaps fake data with real data, stores the page. Core never imports from surface — the coupling is a runtime convention (plugin named "surface" with a `generate` method).

**Form action for generated pages:** Tricky because React renders forms at runtime (the HTML from surface is a JS bundle + `<div id="root">`). Can't string-replace `<form>` tags. Solution: inject `window.__POSITRONIC_FORM_CONFIG__` with a MutationObserver script that sets form action/method and adds hidden CSRF input once the form mounts.

**Cloudflare auto-wiring:** `prepareRunner()` checks for sandbox + browser rendering bindings in env. If present, auto-wires the surface plugin as a default. Brain-level `withPlugin(surface.setup(...))` overrides it. Zero-config for standard Cloudflare deployments.
