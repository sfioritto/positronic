# Unify all DSL callbacks to receive full StepContext

**Status:** shipped
**Started:** 2026-03-19
**Shipped:** 2026-03-19

## Goal

Finish the ongoing effort to give every DSL callback the full `StepContext` instead of cherry-picked subsets. Several callbacks (guard, map `initialState`, templates, nested brain `initialState`/`options`) were still receiving limited context. This was a conceptual inconsistency — "every callback gets the step context" is easy to explain; "some callbacks get state+options, some get state+options+resources, some get the full thing" is not.

## Log

### Investigation

Audited every callback surface in the DSL. Found 7 categories:

- **Already full StepContext:** step actions, wait actions, handle, brain configFn, tool execute, map `over`, ui `notify`
- **Partial context:** guard (`{state, options}`), nested brain `initialState`/`options` (`{state, options, ...services}`), map `initialState` (`(item, outerState)`), map `options` (`{state, options, ...services}`), all templates (`TemplateContext` — state+options+resources)

### Type/runtime mismatch discovery

The builder types for nested brain `initialState`/`options` already promised `StepContext<TState, TOptions> & TServices`, but the runtime only delivered `{state, options, ...services}` — missing `client`, `resources`, `pages`, `env`, `brainRunId`, `stepId`, `currentUser`, `memory`, `store`. No type error because the builder casts `config` to `{initialState?: any, options?: any}` before assigning to the block, and the block types themselves use `{state, options} & TServices` (narrower than the builder promises). The `any` cast erases the connection between the two types.

### Decision: don't tighten block types

The `any` in block types (`MapBlock`, `BrainBlock` fields) is load-bearing — it's what lets heterogeneous blocks live in a single `blocks[]` array where each step changes the state type. Tightening these types would require threading generics through the block union, which directly touches the fragile inference chain. Not worth the risk for internal types. We left them as `any`.

### The change

All runtime call sites now use `buildStepContext(step)`. All builder signatures now use `StepContext<TState, TOptions> & TServices`. `TemplateContext` interface removed (was in blocks.ts, exported from index.ts). Map `initialState` signature changed from `(item, outerState)` to `(item, context)`.

## Learnings

- **Block types _must_ use `any` for callback params — not just for convenience.** We tried putting `StepContext` in the block types for documentation value, but it fails for two reasons: (1) `buildStepContext()` returns `pages: PagesService | undefined` while `StepContext.pages` is non-optional `PagesService`, and (2) `GuardBlock` doesn't carry a `TServices` generic, so `StepContext & TServices` can't be expressed. The `any` in block types isn't laziness — it's structurally required.

- **Prompt templates were a special case** — they're called inside step actions created by the builder (not in event-stream.ts), so the fix was changing the action to accept `context` as a whole and pass it through to the template, rather than destructuring and re-assembling.

- **Zero test changes needed** despite a breaking signature change on map `initialState`. Every test either ignored the second parameter or used only `item`. The `(item, state)` pattern in one test (line 2388) still compiled because the second arg changed from `TState` to `StepContext` — and since the test doesn't use it, no issue.

## Dead ends

None — this was a straightforward mechanical refactor once the investigation was done. The main risk was type inference breakage, which didn't materialize because we only changed callback _input_ types (what the callback receives), not _output_ types (what flows through the state chain).

## Solution

Updated 7 runtime call sites in `event-stream.ts` to use `buildStepContext(step)`, 2 prompt action closures in `brain.ts` to pass full context to templates, and all builder overload signatures to use `StepContext`. Removed `TemplateContext` type entirely. All 777 tests pass, typecheck clean.
