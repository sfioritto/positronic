# IterateResult Collection Class + mapOutput Removal

**Status:** shipped
**Started:** 2026-03-16
**Shipped:** 2026-03-16

## Goal

Iterate steps stored results as raw `[item, result][]` tuples, forcing constant tuple destructuring, type casting, and manual Map construction everywhere results were consumed. The goal was to wrap iterate output in an `IterateResult` class with a richer API (`.items`, `.values`, `.entries`, `.filter()`, `.map()`), then remove `mapOutput` entirely since `IterateResult` makes it unnecessary.

## Log

### IterateResult implementation

Straightforward — the class itself was simple. The interesting parts were:

1. **Serialization just works** — `fast-json-patch` already calls `toJSON()` during `compare()`, so patches automatically contain plain arrays. Verified by grepping the `fast-json-patch` source. This means all existing tests that reconstruct state from patches (the vast majority) pass unchanged.

2. **Two existing tests broke at runtime** — both in the "type inference" describe block. They accessed `IterateResult` during live execution using array-style patterns (`results[0]`, `.reduce()`). Updated them to use the new API (`.items[0]`, `.values.reduce()`). All other iterate tests passed unchanged because they reconstruct state via `applyPatches` which produces plain arrays.

3. **Pre-existing type error** in test-project's `src/index.ts:556` — unrelated to this change, confirmed by building from stashed state.

### mapOutput removal

Clean removal — `mapOutput` existed in 4 layers (block types, builder overloads, builder implementation, event-stream executors) plus tests and docs. With `IterateResult`, everything `mapOutput` did can be done more cleanly with `.values.map()`, `.map()`, or `.filter()`. Removed the `TMapped` type parameter from all overloads too, simplifying the generics considerably.

Note: `seans-bots` has two brains (`find-transcripts.ts`, `search-and-validate.ts`) using `mapOutput` — those will need manual migration.

## Learnings

- `fast-json-patch`'s `compare()` calls `toJSON()` on objects — this is the key insight that makes the whole approach work. Any class with a `toJSON()` method will serialize transparently through the patch system.
- The separation between "live execution" (where state has class instances) and "reconstructed from patches" (where state has plain data) is a fundamental duality in this codebase. Only ~2 tests out of 142 brain tests actually exercise live execution access on iterate results — most use patch reconstruction.
- Removing `mapOutput` simplified the type overloads significantly — the `TMapped = never` + `[TMapped] extends [never]` conditional pattern was clever but added real complexity to every iterate overload. Without it, each overload just maps directly to `IterateResult<TItem, TResult>`.

## Solution

Created `IterateResult<TItem, TResult>` class and removed `mapOutput`:

- New class with: `.items`, `.values`, `.entries`, `.length`, `.filter()`, `.map()`, `[Symbol.iterator]()`, `.toJSON()`
- All 3 iterate executors always produce `IterateResult` (no conditional mapOutput branch)
- Simplified 4 type overloads — removed `TMapped` parameter, direct `IterateResult` types
- Removed `mapOutput` from block type definitions, builder overloads, implementation, and tests
- Removed `IterateResult.from()` — unnecessary since resumed brains don't re-run steps that consume iterate results
- 1 integration test exercises `.values`, `.filter().items`, `.map()`, `.length` during live execution
- 4 mapOutput tests removed
