# Backlog

Living list of parked work from the UI-generation / surface redesign. Ordered by urgency, not commitment.

## Active / in flight

- Nothing — Projects A (IterateResult shape) and B (.page() DSL redesign) landed on `feature/gen-ui-sandbox`. seans-bots callsite migration pending outside this repo.

## Deferred enhancements (clear scope, punt to later)

- **Preview mode** — collapsed content is hidden from the design reviewer, so issues inside closed sections slip past. ~6 files, ~150 lines. Decisions sketched: bypass Radix vs force-via-API for `Accordion`, include `Tabs`, add prompt guidance about `usePreviewMode`.
- **`peek_data` tool** — fallback for schema-field confusion if the full-schema-context approach in the walker ever hits its limits. Lets the generator inspect runtime data at a path.
- **Proof runs of the other endpoints** — only `/sandbox/email-digest` has been verified. `/sandbox/generate`, `/sandbox/hn-reader`, `/sandbox/dev-summary` still untouched under the new walker.
- **`schemaFromData` inference heuristics.** v1 is intentionally plain — only `z.string/number/boolean/array/object` + array counts. Revisit only with evidence that the LLM produces meaningfully worse code without: enum detection (observed-set size → `z.enum` vs `z.string`), date detection (ISO-ish strings → `z.string().datetime()`), nullable vs optional distinction, catalog of "shapes we throw on" with canonical fix snippets per error.
- **schemaFromData location / privacy.** The new `schemaFromData` + plugin wrapper live in `@positronic/surface/src/{plugin,lib}`, so the surface package briefly sees real data at the plugin boundary (it immediately derives a schema and discards it; internal `generate.ts`, the LLM, sandbox, and reviewer still never see real data). If/when we want `@positronic/surface` to see zero real data ever, move `schemaFromData` into core (or a neutral package) and have core derive the schema before calling surface.

## Quality & rigor

- **Systematic code review + cleanup pass.** Walk the surface code top-to-bottom. Look for dead branches, stale comments, over-abstracted helpers, inconsistent patterns. No specific trigger — a deliberate pass.
- **Performance: make each step as fast as possible.** Generation is noticeably slow today. Worth measuring per-stage latency (fake-data walk, `write_component` round-trips, preview screenshot, reviewer verdict) and attacking the longest pole first. Candidates include: parallelize sandbox file writes, cache bundler output when component source is identical across `write_component` calls, reduce reviewer tokens, skip re-bundling when only data changes, batch multi-viewport screenshots more aggressively.
- **Stress-test examples.** More complex schemas beyond email-digest/dev-summary — multi-page workflows, deeply nested arrays, edge cases (very long strings, very wide schemas, rare unions, unusual field name patterns).
- **Evals.** Structured quality measurement: fixed set of prompts+schemas run across model versions, score outputs (approved-iteration count, final-layout quality per rubric, regression detection). Lets us answer "did switching from gemini-flash to gemini-pro help, hurt, or wash?" Rubric approach TBD — options include LLM-as-judge, visual diff against baseline, issue count at approving iteration.

## Architectural / strategic (bigger, could invalidate current work)

- **Real-data simplification.** Drop fake-data entirely in Positronic embedded mode — send real data to the UI generator since it's already been through LLMs upstream. Would remove ~300–400 LOC (walker, counts, inferSchema-with-counts, tuple reshapes). Keep fake-data around only when/if surface is pulled out as a standalone service. Decision: prove the current concept end-to-end first, simplify later.
- **Rename `surface` → `ui`.** Package rename touching imports throughout the monorepo, test-project, templates, and any downstream consumers. Mostly mechanical but wide reach.
- **Swappable components.** Third parties bring their own component library. Preview mode becomes a documented opt-in spec third parties implement.
- **`zodToTypescript` removal.** Not tied to the page-interface redesign — `zodToTypescript` stays as long as the component generator needs a TS type contract for `data` (it does: LLM accessor correctness + sandbox type-check feedback). Only revisit if the generator's feedback mechanism changes materially.

## Minor cleanup

- Pre-existing surface test-project typecheck errors (sandbox helper signatures, `new Response(Uint8Array)` body type). Not in gated typecheck.
- Remove unused `zod-to-json-schema` from `client-anthropic` and `cloudflare` package.jsons (migrated to native `z.toJSONSchema()`).
- Debug log hygiene — if real-data simplification happens, logs contain user data. Be explicit about it somewhere.

## Completed

- **IterateResult serialized shape.** `toJSON()` now emits `{item, result}[]` instead of position-indexed tuples. Internal storage, constructor, re-wrap, and `IterateContext.accumulatedResults` all object-shaped. Public API unchanged for DSL users. Commit `96ed51a`.
- **Page interface redesign.** `.page()` DSL collapses `inputSchema + data` into `inputData`; framework derives schema via new `schemaFromData` utility in `@positronic/surface`. Renames `formSchema` → `outputSchema` for consistency with `.prompt()` / `.map()`. Internal `generate.ts` stays schema-first (test-project unchanged). Commit `9aebf53`. Downstream seans-bots callsites still need updating separately.

## Decided against this session

- **`.describe()` threading in the walker** — not worth the complexity.
- **Hardcoded "never emit JSON" rule in walker prompt** — superseded by full-schema context.
- **Fixing email-digest test-project schema naming** — user-supplied schemas aren't ours to fix.
- **Coercing iterate-result tuples inside `schemaFromData`** — would silently diverge runtime data from the inferred schema and break rendering. Threw the problem at its source instead: `IterateResult.toJSON()` now emits objects, so tuples only appear if a caller explicitly constructs them.
- **Enum/date/nullable inference in `schemaFromData`** — a runtime snapshot can't faithfully describe allowed values across runs, so detecting these from one sample would be wrong more often than right. Kept v1 plain.
