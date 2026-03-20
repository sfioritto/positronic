# JSX for Prompt Templates

**Status:** shipped
**Shipped:** 2026-03-19
**Started:** 2026-03-19

## Goal

Explore replacing template literal functions in the Brain DSL with JSX-based prompt authoring. Current templates are `(context) => string` functions using template literals — they work but become hard to read inline as prompts grow complex. JSX would give better IDE support, conditional rendering, composable prompt fragments, and composition via function components.

**Why:** Templates are already shaped like React components — `(props) => output`. The codebase is TypeScript everywhere, TSX is familiar. As prompts get more complex (the prosumer vision), template literals hit a wall on readability, composition, and IDE support. Pulling prompts into separate files helps readability but loses the inline ergonomics.

## Log

### Initial design exploration (2026-03-19)

**Core problem:** Template literals inside chained builder patterns look terrible in IDEs. The text breaks out of code indentation, conditionals are ugly ternaries, loops need `.map().join('\n')`, and Prettier doesn't touch template literal contents. Real examples from the codebase (find-transcripts brain, HN top stories brain) show text running flush-left breaking all visual structure.

**Key design decisions reached:**

1. **It's just a string builder.** Not structured messages, not HTML. The template function still returns a string. JSX is purely for better authoring ergonomics — formatting, interpolation, conditionals, loops, composition. No API changes needed.

2. **Custom JSX factory in core, not a library.** Hono JSX, Preact, vhtml are all HTML-oriented (escaping, void elements, HTML whitespace rules). Prompts need different semantics. Custom factory is ~60-80 lines of plain TypeScript.

3. **Template function IS the component.** `template: ({ state }) => <>...</>` — no wrapper function, no `render()` call. The runner detects TemplateNode returns and renders internally. Backward compatible with string returns.

4. **Async function components are the extensibility primitive.** `<Resource>` is just a built-in async component. Users can write their own async components for any use case. The renderer always awaits component results.

5. **Naming: Template*, not Prompt*.** Types are `TemplateNode`, `TemplateChild`, `TemplateElement` — used across prompt steps, agent steps, UI steps, not just prompts.

6. **Lives in core, not a separate package.** The JSX runtime (`createElement`, `Fragment`, `renderTemplate`) is plain TypeScript in `packages/core/src/`.

### Whitespace problem and solution (2026-03-19)

**The hard part:** JSX compilers (TypeScript, SWC) collapse whitespace in text nodes at compile time, before the custom runtime sees it. `Line one\nLine two` becomes `"Line one Line two"`. This breaks the "what you see is what you get" promise.

**Options considered:**

- A. Use HTML-subset elements (`<p>`, `<br/>`) for line control — works but verbose
- B. Custom SWC plugin to preserve whitespace — best DX, adds build dependency
- C. Tagged template literals instead of JSX — avoids problem but loses JSX benefits
- D. Hybrid (JSX structure + string expressions for formatted text) — defeats the purpose

**Decision: SWC Wasm plugin (option B).** A pre-processor that runs before the JSX transform, converting `JSXText` nodes into `JSXExpressionContainer(StringLiteral(rawText))`. Expression containers are left alone by the compiler, preserving all whitespace. ~30-40 lines of Rust.

- Plugin only ships in generated projects, NOT used in the monorepo (to avoid scoping complexity with Ink/React JSX in the CLI)
- Monorepo tests using template JSX accept whitespace collapsing, with a doc note
- Already have precedent: `@swc/plugin-transform-imports` is in use
- Main maintenance concern: SWC plugin version coupling (plugins must match `swc_core` version)

### Architecture summary

```
User writes JSX in .tsx
  ↓
SWC plugin: JSXText → JSXExpressionContainer (preserves whitespace)
  ↓
SWC JSX transform: createElement/Fragment calls (expressions pass through)
  ↓
Runtime: createElement builds TemplateNode tree
  ↓
Brain runner: detects TemplateNode return, calls renderTemplate()
  ↓
renderTemplate: walks tree, concatenates strings, auto-dedents → final string
  ↓
String goes to AI client as prompt
```

**Pieces to build:**

1. JSX runtime in core — `createElement`, `Fragment`, types, `renderTemplate()` (~60-80 lines plain TS)
2. SWC Wasm plugin — Rust, ~30-40 lines, published as npm package with `.wasm` binary
3. Generated project template updates — tsconfig (`jsx`, `jsxImportSource`) and `.swcrc` (plugin)
4. Runner integration — small change in `event-stream.ts` to detect TemplateNode and call renderTemplate()

## Learnings

- JSX whitespace collapsing happens at COMPILE TIME (in the parser/transform), not at runtime. A custom `createElement` cannot recover the original whitespace. This is the fundamental constraint that drives the SWC plugin approach.
- Expression containers (`{expr}`) in JSX are passed through unchanged by the compiler — this is the escape hatch that makes the plugin approach work.
- The template function signature `(context) => JSXElement` is already identical to a React functional component. The whole design falls out naturally from this observation.
- SWC Wasm plugins run BEFORE the JSX transform in the pipeline, which is exactly when we need to intercept text nodes.
- Already using `@swc/plugin-transform-imports` (v6.5.2) — plugin infrastructure is proven in this project.

## Dead ends

- **Structured messages (system/user/assistant) via JSX:** Initially seemed like the killer feature, but the AI clients already expect system message as a separate string property. All current use cases just need a string. Structured messages would be a future addition if needed — the JSX infrastructure would support it, but it's not the motivating problem.
- **MDX:** Considered as an alternative. It's markdown-first with JSX embedded, which fits prompt authoring well. But it's a file format (not inline), requires a compiler pipeline (unified/remark/rehype), and has weaker TypeScript type safety. The problem is inline formatting in `.tsx` files, not separate content files.
- **HTML-subset intrinsic elements for whitespace control:** `<p>`, `<br/>`, `<ul>/<li>` etc. mapped to markdown output. Works and has zero build complexity, but verbose — wrapping every line in `<p>` is noisy. The SWC plugin approach is better DX if we're willing to accept the build dependency.

## Solution

Implemented a custom JSX runtime in `packages/core/src/jsx-runtime.ts` (~50 lines) with an async tree-walking renderer in `packages/core/src/template/render.ts` (~70 lines). The runtime exports `jsx`, `jsxs`, and `Fragment` for the automatic JSX transform, and a `JSX` namespace for type checking.

The runner integration is minimal — `resolveTemplate()` wraps all 4 template call sites (2 in brain.ts, 2 in event-stream.ts) with a type check: if the template returned a string, pass through; if it returned a TemplateNode, render to string. Fully backward compatible.

Generated projects get `jsx: "react-jsx"` and `jsxImportSource: "@positronic/core"` in their tsconfig. The SWC whitespace plugin (for WYSIWYG text in JSX) is a separate follow-up.

This approach won because it's the minimum viable change — no new dependencies, no build pipeline changes in the monorepo, and templates still return strings from the runner's perspective. The JSX is purely an authoring convenience that compiles away.
