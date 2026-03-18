# Continuation Pattern for Brain Class

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

The Brain class had 6 generic type parameters: `TOptions`, `TState`, `TServices`, `TResponse`, `TPage`, `TStore`. Two of them — `TResponse` and `TPage` — were ephemeral: they existed for exactly one step then reset to `undefined`. They bloated every type signature, polluted autocomplete, and allowed incorrect usage patterns.

The goal was to remove `TResponse` and `TPage` entirely from the developer-facing API, replacing the ephemeral data pattern with a `Continuation` class. Operations that produce data not auto-merged into state (`.wait()`, schema-less `.prompt()`, `.ui()` with `responseSchema`) return a `Continuation` whose `.handle()` callback is the only place the ephemeral data is visible to TypeScript.

## Log

### Implementation

Created a single `Continuation<TOptions, TState, TServices, TStore, TResponse>` class with `.handle()` and `.guard()` methods. The `.handle()` callback receives `StepContext<TState, TOptions> & TServices & StoreContext<TStore> & { response: TResponse }` — the intersection "reveals" `response` only inside the callback.

Key insight: **runtime context objects still have `response` and `page`** — `buildStepContext()` in event-stream.ts always includes them. TypeScript just doesn't expose them in the cleaned-up `StepContext<TState, TOptions>`. This is normal structural typing: extra runtime properties are invisible to the type system. This means we didn't need to change the execution engine at all.

The `.ui()` method got split into two overloads: with `responseSchema` (returns `Continuation`) and without (returns `Brain`). When `responseSchema` is present, `executeUIStep` now natively yields a WEBHOOK event after the step completes — no separate `.wait()` block needed. A `notify` callback was added for side effects (Slack notifications etc.) that need the page URL.

### Test migration

Every `.wait().step()` pattern became `.wait().handle()`. Tests that just called `.wait()` terminally (to verify webhook events) needed a `.handle('Done', ({ state }) => state)` appended since `.wait()` no longer returns a `Brain` with `.run()`.

Two agent tests accessed `response` on the config function params to verify it was undefined — since `response` is no longer on the type, these needed `(params as any).response` casts. The runtime behavior is unchanged.

### Pre-existing breakage

`type-inference-debug.ts` had been broken since the `.map()` refactor (3-arg `.prompt()` with `over` no longer exists). Not related to this change.

## Learnings

- **Structural typing makes ephemeral data patterns clean**: The runtime still puts `response` on every context object. TypeScript's structural typing means the intersection in `.handle()` "reveals" it without any runtime changes. No conditional logic, no runtime type guards.

- **`Continuation` as a type-level lock**: The key benefit isn't just hiding `response` — it's that you _can't chain `.step()` after `.wait()`_. The type system forces you through `.handle()`, making the data flow explicit. Before, you could `.wait().step().step()` and the second step would silently have `response: undefined`.

- **UI suspend is just a WEBHOOK yield**: Adding native suspend for `.ui()` with `responseSchema` was trivial — the existing WEBHOOK event mechanism already handles everything. The consumer (BrainRunner/DO) doesn't care whether the WEBHOOK came from a WaitBlock or a UI step.

## Solution

Removed `TResponse` and `TPage` from `Brain` (now 4 generic params), removed `response` and `page` from `StepContext` (now 2 generic params). Operations producing ephemeral data return `Continuation` whose `.handle()` injects `response` via intersection type. Runtime execution unchanged — `buildStepContext()` still constructs the full context object.

Files: new `continuation.ts`, modified `brain.ts`, `types.ts`, `blocks.ts`, `event-stream.ts`, `create-brain.ts`, barrel exports, and test migrations across 5 test files + `example-webhook.ts` + cloudflare test-project.
