# JSX for Prompt Templates

**Status:** active
**Started:** 2026-03-19

## Goal

Explore replacing template literal functions in the Brain DSL with JSX-based prompt authoring. Current templates are `(context) => string` functions using template literals — they work but become hard to read inline as prompts grow complex. JSX would give better IDE support, conditional rendering, composable prompt fragments, and potentially structured message output (system/user/assistant roles).

**Why:** Templates are already shaped like React components — `(props) => output`. The codebase is TypeScript everywhere, TSX is familiar. As prompts get more complex (the prosumer vision), template literals hit a wall on readability, composition, and IDE support. Pulling prompts into separate files helps readability but loses the inline ergonomics.

## Log

### Initial design exploration (2026-03-19)

Key questions being worked through:

1. **JSX-only library vs custom factory vs React?** Don't need React's runtime (state, effects, reconciliation). Just need the JSX syntax → tree → string/messages pipeline.

2. **How does context (state, options, resources) flow into components?** The template function signature `(context) => Element` already IS a functional component. Question is whether to keep that shape or use a provider/context pattern.

3. **Async rendering for resources.** Resources are lazy-loaded and potentially large. JSX doesn't natively support async. Need a strategy for `<Resource>` components or async render passes.

4. **Structured messages.** JSX naturally maps to `[{role: "system", content: "..."}, {role: "user", content: "..."}]` — this is potentially the biggest win over flat string templates.

Options considered for JSX runtime:

- **Custom factory (~50-100 lines)** — full control over whitespace, async, prompt semantics. No HTML baggage.
- **Hono JSX** — supports async components, string rendering. But HTML-focused (escaping, entities).
- **Preact** — lightweight but still brings lifecycle, state, effects we don't need.
- **vhtml** — hyper-minimal JSX→string by Preact author. HTML-focused though.

Leaning toward: custom factory. Prompt rendering has different semantics than HTML (whitespace handling, no escaping, role-based structure, async resources). Fighting an HTML-oriented library would be worse than writing 50 lines of custom code.

## Learnings

(In progress)

## Dead ends

(None yet)
