# Give `over` the full step context and async support

**Status:** shipped
**Started:** 2026-03-16
**Shipped:** 2026-03-16

## Goal

The `over` function in iterate configs only received `(state)`, which forced users to stash values from options/services into state in a preceding step just so `over` could access them. The function should receive the same context object as step actions (`{ state, options, client, resources, services, ... }`) and support returning a Promise. This is a backwards-incompatible API change.

## Log

### Implementation

Straightforward mechanical change across ~6 files. The interesting parts:

1. **Extracted `buildStepContext` helper** in event-stream.ts. The same context object was being constructed in 4+ places (step actions, agent config functions, tool execution, wait actions). Added a single helper that all iterate `over` calls now use. The existing call sites for step/agent/wait actions weren't refactored to use it yet — that's a separate cleanup.

2. **`await` is safe at all 3 call sites** because `executeIteratePrompt`, `executeIterateBrain`, and `executeIterateAgent` are all async generators. Adding `await` to a sync return is a no-op, so existing sync `over` functions work unchanged.

3. **One test had `(state: any)` with explicit type annotation** instead of just `(state)`, so the bulk `replace_all` of `over: (state) =>` to `over: ({ state }) =>` missed it. Caught it on the first test run.

### Pre-existing typecheck issue

The test-project's `iterateOptionsTestBrain` at line 556 has a pre-existing overload resolution failure — the inner brain's `TOptions` (`z.object({}).passthrough()`) doesn't match the outer brain's `TOptions` (`{ multiplier: number }`), so TypeScript can't match overload 6 (nested brain with iterate). Confirmed this exists on the clean main branch too. Not introduced by this change.

## Learnings

- **`replace_all` misses variant patterns.** When doing mechanical find-and-replace, always grep for variant patterns too (e.g., `over: (state:` with type annotations, not just `over: (state)`). One missed instance caused a runtime error (`Cannot read properties of undefined (reading 'length')`) because `over` was still receiving state directly but trying to destructure `{ state }`.

- **Template docs need updating too.** The `template-new-project/template/docs/` files contain code examples with `over` usage. These are marked as binary in the caz template engine (so they're not processed as templates), but they still need to reflect the current API.

## Solution

Changed `over: (state) => items[]` to `over: (context) => items[] | Promise<items[]>` where `context` is the same `StepContext & TServices & StoreContext` that step actions receive. Updated type definitions, ~10 overload signatures, 3 runtime call sites (with `await`), ~40 test instances, and template documentation. Extracted `buildStepContext` helper to reduce duplication at call sites.
