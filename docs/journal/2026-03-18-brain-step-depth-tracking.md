# .brain() step handler missing depth tracking

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

Fix a bug where `.map()` in brain mode doesn't work when the brain containing it runs as a child via `.brain()`. The map step's inner brain events were being misinterpreted by the parent `.brain()` handler.

## Log

### Root cause

The `.brain()` step handler in `event-stream.ts` iterates over all events from the child brain's `run()`. It had two problems:

1. **Broke on the first COMPLETE event** — which could be from a deeply nested brain (e.g., the map's inner brain), not the direct child. This caused the handler to exit before the map step or any subsequent steps completed.
2. **Collected patches from all STEP_COMPLETE events** — including those from deeper brains. A processBrain's patch like `{op: 'add', path: '/result', ...}` (from the outputSchema name) would land on the parent state, which is why the user saw results under `result` instead of `results` (the outputKey).

The state machine already handles this correctly — it tracks depth via START/COMPLETE events and only applies patches at the appropriate execution stack level. But the `.brain()` handler was doing its own manual patch collection without any depth awareness.

### The fix

Added a local `innerDepth` counter to the `.brain()` handler's event loop:

- Increment on START
- Decrement on COMPLETE (break when reaching 0)
- Decrement on ERROR (errored brains don't emit COMPLETE, and errors may be caught by map error handlers)
- Only collect patches when `innerDepth === 1` (direct child brain)

For the resume case: resumed brains skip their START event, so `innerDepth` starts at 1 instead of 0.

This variable is purely local — it doesn't affect the state machine's depth tracking or UI rendering. All events are still yielded unchanged.

## Learnings

- The `.brain()` handler was essentially a simplified version of what the state machine does (collect patches, reconstruct state), but without the depth awareness the state machine has. When `.brain()` only ran simple inner brains (no nesting), the first COMPLETE was always the right one. The bug only surfaced when inner brains themselves spawned brains (via `.map()` brain mode or nested `.brain()` steps).

- The same bug would affect `.brain()` steps running brains that themselves have `.brain()` steps — any nesting beyond one level deep. The `.map()` brain mode case just made it obvious because the map runs multiple inner brains per step.

- ERROR events need depth tracking too. When an inner-inner brain errors, it emits ERROR (not COMPLETE) and then throws. If the error is caught (e.g., by `.map()`'s error handler), execution continues — but without decrementing depth on ERROR, the counter drifts and subsequent patches get skipped.

## Solution

Two-line conceptual change in `packages/core/src/dsl/execution/event-stream.ts`: added `innerDepth` counter with START/COMPLETE/ERROR tracking. Test added in `brain.test.ts` confirming `.map()` brain mode works correctly when the parent brain runs as a child via `.brain()`.
