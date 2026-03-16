# Iterate Brain Silent Drops

**Status:** shipped
**Started:** 2026-03-16
**Shipped:** 2026-03-16
**Commit:** (pending)

## Goal

User's podcast discovery brain was silently losing results during the `.brain()` iterate step — items that completed successfully were disappearing from the results array. 7 out of 9 items would vanish with no error logged.

## Log

### Initial investigation: wrong diagnosis

Extensive debugging pointed at V8/SWC async generator corruption. Evidence seemed strong:

- Values were correct at assignment time but gone when read back
- Map.set() also appeared to fail silently
- The bug only manifested in workerd, not in Node.js/Jest

Tried multiple workarounds:

1. `.fill(undefined)` to force dense arrays — didn't help
2. `Map<number, [any, any]>` instead of indexed arrays — didn't help
3. Class property Map (`this.iterateResults`) — didn't help
4. Incremental `this.currentState` accumulation — didn't help
5. Extract iterate loop to regular async function (no yields) — inconclusive (test infra issue)
6. SWC `.swcrc` target ES2022 for native async generators — didn't help

### The real bug: brain-state-machine.ts

After exhausting generator/runtime theories, the user identified the actual bug in `brain-state-machine.ts`. The `completeStep` reducer unconditionally set `iterateContext: null` on **every** `STEP_COMPLETE` event — including inner brain step completions during iteration.

The iterate pattern:

- Outer brain runs inner brain for each item
- Inner brain emits `STEP_COMPLETE` events for its own steps
- Each inner `STEP_COMPLETE` wiped `iterateContext`
- `ITERATE_ITEM_COMPLETE` would repopulate it with just that one item
- When the DO restarted and replayed events from SQLite, earlier items were lost

This perfectly explains why exactly 2 items survived (the last 2 before the DO's final event replay) and why it only manifested in workerd (which uses alarm-based pause/resume with event replay).

### The fix

Three-line change in `brain-state-machine.ts`:

1. Added `stepId` field to `IterateContext` interface
2. `iterateItemComplete` reducer stores `payload.stepId` in the context
3. `completeStep` reducer only clears `iterateContext` when `ctx.iterateContext?.stepId === stepId`

Also added `.swcrc` with `"target": "es2022"` to the core package — produces native async generators instead of SWC's `_ts_generator` state machine. Not required for the fix but produces cleaner compiled output.

## Learnings

- **Symptoms can be perfectly consistent with the wrong diagnosis.** Every observation (values present at assignment time, gone when read back, only in workerd) pointed at a V8/SWC runtime bug. The real cause was a state reconstruction bug that only triggered during Cloudflare's alarm-based pause/resume cycle. The runtime was fine — the state machine was eating the data during event replay.

- **When debugging "impossible" data corruption, consider all the places state is reconstructed.** We focused on the code that _produces_ results (event-stream.ts) and never looked at the code that _replays_ them (brain-state-machine.ts). The bug was in the consumer, not the producer.

- **The "only in workerd" signal was misleading.** It wasn't a V8 bug — it was that only workerd exercises the pause/resume/replay path. Node.js/Jest runs brains straight through without ever replaying events through the state machine.

- **SWC `.swcrc` target es2022** prevents unnecessary async generator downleveling. Workerd's V8 supports native async generators. All 759 tests pass with native generators.

## Dead ends

- **V8 holey array bug theory**: Extensive investigation into V8's array internals, sparse vs dense representations, JIT optimization interference. The arrays were fine.
- **SWC generator state machine corruption theory**: Analyzed compiled `_ts_generator` output, var hoisting, state machine control flow. The compilation was correct.
- **Regular async function extraction**: Extracted the iterate loop into a non-generator function to avoid yield points. This caused isolated storage errors in the test framework and was never properly validated. Would have been unnecessary anyway.
- **esbuild re-transformation theory**: Started investigating whether wrangler's esbuild was re-downleveling native async generators. This was a rabbit hole — the bundler was irrelevant.

## Solution

The `completeStep` reducer in `brain-state-machine.ts` was unconditionally clearing `iterateContext` on every `STEP_COMPLETE` event. Inner brain steps during iteration triggered this, wiping accumulated results before the iterate step itself completed. The fix adds a `stepId` to `IterateContext` and only clears it when the completing step matches the iterate step.

Also added a regression test (`iterate-brain.test.ts`) in the cloudflare test-project that runs 7 items through a `.brain()` iterate step in workerd.
