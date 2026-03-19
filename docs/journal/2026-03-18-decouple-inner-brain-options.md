# Decouple Inner Brain Options from Parent

**Status:** shipped
**Started:** 2026-03-18

## Goal

Inner brains nested via `.brain()` and `.map()` were forced to share the same `TOptions` type as their parent. Options were automatically propagated from parent to child at runtime (`event-stream.ts` passes `this.options`). This killed composability — you couldn't nest a reusable inner brain with its own options schema inside a parent with different options.

The fix: inner brains define their own options schema independently. Parents pass options explicitly via a new `options` field in the config — same pattern as `initialState`.

## Log

### Implementation

Five files changed: `blocks.ts` (added `options` field to BrainBlock and MapBlock), `brain.ts` (overloads + implementations for `.brain()` and `.map()`), `event-stream.ts` (evaluate options config and pass to inner brain `run()` for both brain-step and map-brain-mode paths), `brain.test.ts` (new test + updated existing type inference test), and cloudflare `index.ts` (updated iterate-options brains to use options instead of state for multiplier).

### Conditional type approach failed

The plan called for a conditional intersection type to make `options` **required** when the inner brain has a specific schema and **optional** when it doesn't:

```typescript
config: { outputKey, initialState? } & (JsonObject extends TInnerOptions
  ? { options?: TInnerOptions | ... }
  : { options: TInnerOptions | ... })
```

This doesn't work with TypeScript's overload resolution. The project uses `composite: true` with project references, so `tsc --noEmit` resolves types from built `.d.ts` files. But even after rebuilding, the conditional type that depends on a type parameter being inferred in the same overload signature gets deferred by TypeScript — it can't evaluate `JsonObject extends TInnerOptions` while `TInnerOptions` is still being inferred from the `innerBrain` argument. The result: TypeScript shows the config type without the intersection at all, treating `options` as an unknown property.

Simplified to always-optional `options?` field. The inner brain's `optionsSchema` still validates at runtime, so missing options are caught — just not at compile time for the "required" case.

### Build order matters

First typecheck attempt after editing source files showed the _old_ overload types in error messages. Root cause: `composite: true` project references mean `tsc --noEmit` reads from previously built `.d.ts` files, not source. Must run `npm run build:workspaces` before `npm run typecheck` to pick up source changes.

## Learnings

- **Conditional types in overload parameters are unreliable** when the condition depends on a type parameter being inferred from another argument in the same call. TypeScript defers the conditional, and the intersection effectively disappears from the resolved type.
- **`composite: true` project references** mean typecheck reads `.d.ts` output, not source. Always rebuild before typechecking when editing type signatures.
- The `options` evaluation pattern (static value or function receiving outer context) mirrors `initialState` exactly — consistent API surface.

## Dead ends

### Conditional intersection for required options enforcement

Seemed like the perfect TypeScript pattern — `JsonObject extends TInnerOptions` is true for the default/unspecified case and false for specific schemas. But overload resolution + deferred conditional types made this a non-starter. The simpler always-optional approach works because the inner brain's Zod schema validates at runtime anyway.

## Solution

Added `options` field to `BrainBlock` and `MapBlock` block types. Updated `.brain()` and `.map()` overloads to accept `Brain<TInnerOptions, TInnerState, any>` (decoupled from parent's `TOptions`), with an optional `options` config field typed as `TInnerOptions | ((context) => TInnerOptions)`. Runtime evaluates the options config (static or function) and passes the result to the inner brain's `run()` call, replacing the old `this.options` propagation. Services (`TServices`) still propagate from parent to child — only options are decoupled.
