# Propagate Services and StoreProvider to Nested Brains

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

Services set via `.withServices()` and `storeProvider` passed to `run()` were not forwarded to nested brains. This meant:

- Child brains couldn't inherit services from parents
- Tests couldn't inject mock services that cascade down
- Nested brains with `.withStore()` couldn't get their own store instances

The design goal: treat `.withServices()` as **types + defaults**, and allow runtime services to cascade. Child's own services override parent's.

## Log

### Implementation

Straightforward four-point change:

1. Added `services?: Record<string, any>` to `BaseRunParams` for runtime service injection
2. In `Brain.run()`, merged `params.services` (runtime/parent) as defaults with `this.services` (brain's own) as overrides
3. Stored `storeProvider` on `BrainEventStream` so it's available at nested brain call sites
4. Forwarded both `services` and `storeProvider` at all three `innerBrain.run()` call sites in event-stream.ts (resume, fresh, iterate)

### TypeScript constraint on nested brain tests

The `.brain()` overload signature requires `innerBrain: Brain<TOptions, TInnerState, TServices>` — meaning the child brain's `TServices` type must match the parent's. This is correct for normal usage (parent and child share the same service type), but for tests verifying runtime propagation to a child that doesn't call `.withServices()`, the types don't align. Used `as any` casts in the test — this is fine because we're testing the runtime merging behavior, not the static type safety.

## Learnings

- The merge direction matters: `{ ...parentServices, ...childServices }` means child wins, which is the right semantic. Parent/runtime services are defaults; the brain's own `.withServices()` definitions always take priority.
- `storeProvider` is a factory function, not a store instance. It needs to be forwarded so each nested brain can call it with its own `storeSchema` and `brainTitle` to get a correctly-scoped store.
- The `services` field on `BaseRunParams` uses `Record<string, any>` rather than a generic because run params flow through BrainRunner, backends, and tests that don't know `TServices`.

## Solution

Four small edits across three files, plus four new tests. The merge happens in `Brain.run()` with spread operator — parent/runtime services as base, brain's own services spread on top. `storeProvider` is stored as a private field on `BrainEventStream` and passed through to all three nested brain call sites.
