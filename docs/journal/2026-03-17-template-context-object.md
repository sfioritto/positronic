# Unify template callbacks to context object pattern

**Status:** shipped
**Started:** 2026-03-17
**Shipped:** 2026-03-17

## Goal

The `.prompt()` and `.ui()` template callbacks used positional args `(state, resources)` or `(item, resources)`, while step action callbacks receive a context object `({ state, options, resources, ... })`. This meant iterate templates couldn't access `options` at all, and the API was inconsistent. Unifying to a context object fixes both issues.

## Log

### Implementation

Straightforward mechanical refactor across the codebase. Two new lean interfaces (`TemplateContext` and `IterateTemplateContext`) in `blocks.ts` — deliberately not reusing `StepContext` since templates shouldn't have `client`, `memory`, `store`, etc.

The key insight was that the call sites in `event-stream.ts` are what actually construct the context objects, and the overloads in `brain.ts` define the public API. The implementation closures inside `brain.ts` (schema-less prompt and single-prompt action) also needed updating since they call `config.template(...)` directly.

### One test missed on first pass

The first `npm run dev` caught one failure: a test that named its iterate item parameter `email` instead of `item`. The grep pattern `template: (item` didn't catch `template: (email:`. Lesson: when doing broad callback signature changes, search for the _pattern_ (any function receiving positional args after `template:`), not just common variable names.

## Learnings

- The `TItems extends any[]` + `TItems[number]` inference pattern (from MEMORY.md) survived the change cleanly. `IterateTemplateContext<TItems[number], TState, TOptions>` uses `TItems[number]` as a computation inside the type, not as an inference site, so the iterate overload still infers `TItems` from `over` and propagates it to the template. No regression.

- Template doc files in `packages/template-new-project/template/docs/` are marked as binary by the caz template engine's `prepare` hook, so they don't get processed for `<%= %>` syntax. But the callback signatures still needed updating to match the new API.

- The `docs/ui-step-guide.md` at the repo root (not inside the template) also had template examples that needed updating — easy to miss since it's outside the packages directory.

## Solution

Added `TemplateContext<TState, TOptions>` and `IterateTemplateContext<TItem, TState, TOptions>` interfaces to `blocks.ts`. Updated all three prompt overloads, the `.ui()` method, the implementation closures, and both call sites in `event-stream.ts`. Exported the new types from `index.ts`. Updated ~30 template callbacks across tests and ~25 across documentation files.

Breaking change by design — all existing `(state) =>` callbacks become `({ state }) =>` and `(item) =>` becomes `({ item }) =>`. Zero-arg templates `() => 'string'` are unaffected since TS allows fewer params.
