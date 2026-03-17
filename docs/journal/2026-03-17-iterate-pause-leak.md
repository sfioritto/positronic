# Iterate PAUSE Leak in Inner Brains

**Status:** shipped
**Started:** 2026-03-17
**Shipped:** 2026-03-17
**Commit:** 13dc5b1

## Goal

When `find-transcripts` runs `search-and-validate` as an inner brain via `.brain()` iterate, the user sees a spurious "Brain paused. Press 'r' to resume." message. The brain isn't actually paused by the user — it's the Cloudflare DO memory reclamation mechanism leaking into the UI.

## Log

### Root cause

The `IterateItemAdapter` in `brain-runner-do.ts` queues a PAUSE signal after every `ITERATE_ITEM_COMPLETE` event. This works fine for top-level brains — they have a signal provider, so the PAUSE gets consumed by the iterate loop's signal check, which silently stops execution so the DO can restart.

But inner brains running via `.brain()` iterate don't get a signal provider. So when the inner brain emits its own `ITERATE_ITEM_COMPLETE` events (if it has iterate steps), the adapter queues PAUSE signals that nobody consumes. These stale PAUSE signals leak up to the outer brain's main loop, which interprets them as a user-initiated pause and emits a PAUSED event to the UI.

### First approach: RELEASE signal type (rejected)

The initial plan was to add a new `RELEASE` signal type — semantically distinct from PAUSE — so the core could differentiate "user pressed pause" from "backend wants to restart for memory." This required touching 6 files: types.ts, event-stream.ts (3 iterate methods), mock-signal-provider.ts, brain-runner-do.ts (adapter + SQL), and 3 test updates.

The user correctly pointed out this was unnecessary. On the consumer side, RELEASE and PAUSE did the exact same thing (`this.stopped = true; return`). The distinction only matters on the **producer** side — the adapter needs to know whether it's safe to queue a signal. A new signal type was the wrong abstraction for a producer-side concern.

### Final approach: canRelease flag on the event

The fix is a single boolean `canRelease` on the `ITERATE_ITEM_COMPLETE` event, set to `!!this.signalProvider`. Top-level brains (which have a signal provider) emit `canRelease: true`. Inner brains emit `canRelease: false`. The adapter checks this flag before queuing PAUSE — if `canRelease` is false, it does nothing.

3 files changed instead of 6. No new signal type polluting the type system.

## Learnings

- **Producer-side vs consumer-side concerns.** When two signal types would have identical consumer behavior, the distinction belongs on the producer side. Adding a new signal type is a consumer-side change that ripples through the entire signal chain (types, priority ordering, filters, SQL queries, tests). A flag on the event keeps the decision at the source.

- **The "would I need different behavior later" test.** The only future scenario where RELEASE-as-a-signal matters is if PAUSE eventually emits a PAUSED event to the UI while RELEASE stays silent. But that behavior wasn't in this diff, so it was premature complexity. If that need arises, adding the signal type then is straightforward.

- **Stale build artifacts cause confusing type errors.** The first `npm run typecheck` failed with errors saying `{ type: 'RELEASE' }` wasn't assignable to `BrainSignal` — even though RELEASE was clearly in the union. The root tsconfig uses project references with `composite: true`, so `tsc --noEmit` resolves `@positronic/core` through the built `.d.ts` declarations, not the source. The stale declarations didn't include RELEASE yet. Fix: `npm run dev` (which runs `build:workspaces` first) instead of just `npm run typecheck`.

## Dead ends

- **RELEASE signal type**: Fully implemented across 6 files before being reverted. The implementation was correct and all tests passed, but it was unnecessary complexity. The learning: when you find yourself adding identical handlers for two signal types, question whether you need a new signal type at all.

## Solution

Added `canRelease: boolean` to `IterateItemCompleteEvent`. Set to `!!this.signalProvider` at all three iterate emit sites in `event-stream.ts`. The `IterateItemAdapter` in `brain-runner-do.ts` checks `canRelease` before queuing PAUSE. Inner brains (no signal provider) get `canRelease: false`, so their events are ignored by the adapter — no stale PAUSE leaks.
