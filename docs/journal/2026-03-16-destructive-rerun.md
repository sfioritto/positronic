# Destructive Rerun: Reset Brain Run to Step N

**Status:** shipped
**Started:** 2026-03-16
**Shipped:** 2026-03-16

## Goal

The rerun feature had a fully built CLI and API endpoint, but the backend was broken — it created a _new_ Durable Object and passed rerun params as `initialState`, silently corrupting the run. The spec test existed but was never wired up, so nothing caught this.

The user needs rerun for development iteration: run an expensive brain once, then re-execute from a specific step without re-running earlier steps.

## Log

### The key insight: reuse the DO, don't create a new one

The old approach tried to create a fresh DO with rerun parameters baked into `initialState`. This was fundamentally wrong — the new DO had no event history, so the brain just started fresh with garbage initial state.

The fix: **destructive rerun** on the _same_ DO. The DO already stores all events in SQLite. The `wakeUp()` resume path already replays events through a state machine to reconstruct state. If we truncate events to just before step N, then call `wakeUp()`, the existing resume machinery handles everything automatically.

### Counting top-level steps

The state machine already tracks `isTopLevel` (true when `depth === 1`) and `topLevelStepCount`. For the cutoff calculation, we replay events through a fresh state machine and count `STEP_COMPLETE` events where `machine.context.isTopLevel` is true after sending. This correctly handles inner brain steps — they don't count toward the top-level step count.

### Simplifying the API contract

The old API accepted `identifier`, `runId`, `startsAt`, and `stopsAfter` — all optional. The new contract requires only `runId` and `startsAt`, returns the same `runId` plus `brainTitle`, and drops `stopsAfter` entirely. `stopsAfter` was removed because it would require synthesizing a terminal event when execution is cut short.

The response code changed from 201 to 200 since we're not creating a new resource — we're modifying an existing one.

### Review cleanup: dropping the vestigial `<brain>` arg

First pass kept `<brain>` as a positional arg even though the server never uses it (it only needs `runId` and `startsAt`). The `<brain>` arg was threading through BrainResolver, the command interface, and the component — all for two display strings. Dropped it entirely. The server now returns `brainTitle` from `monitorStub.getLastEvent()`, and the CLI displays it from the response. Command is now just `rerun <run-id> --starts-at N`.

### Table cleanup in rerun()

Initially called `initializeSignalsTable()` / `initializeWaitTimeoutTable()` before `DELETE` statements. For a run with events, those tables already exist. For a brain that never used signals/wait, the tables don't exist — and `DELETE` on a non-existent table throws. Used `DROP TABLE IF EXISTS` + reset the initialized flags instead, so `wakeUp()` recreates them fresh when needed.

### Spec test isolated storage

The rerun spec test's `wakeUp()` call starts fire-and-forget async work in the DO. If the test exits before that work completes, the vitest pool-workers runner hits the classic isolated storage error. Fixed by polling `GET /brains/runs/:runId` after the rerun until the brain reaches a terminal state, ensuring all DO async work settles before the test ends.

## Learnings

- `loadAllEventsWithIds()` returns events paired with their SQL row IDs. Needed because the cutoff point for truncation is a specific SQL row, not just a position in the event list.

- The DO's `wakeUp()` path is robust enough to piggyback on for rerun — it replays all events, reconstructs state, and calls `BrainRunner.resume()`. Truncating events before calling it gives us rerun for free.

- SQLite `DELETE FROM table` throws if the table doesn't exist — there's no `DELETE FROM IF EXISTS` syntax. Use `DROP TABLE IF EXISTS` when you can't guarantee the table was created.

- In vitest pool-workers, any DO method that launches fire-and-forget async work (like `wakeUp()`) will cause isolated storage errors if the test exits before the work settles. Always poll for completion.

- When a CLI command's only use of a positional arg is display text, and the server already has that data — just return it from the server. Don't make users type extra args for cosmetic output.

### Success gate fix

Review caught that `brainTitle` was being used as the success condition (`brainTitle ?`) in the component render — if the server ever returned an empty string or null for `brainTitle`, the UI would show "Unexpected error occurred" even though the rerun succeeded. Added a separate `success` boolean state to gate the UI, keeping `brainTitle` for display only.

## Solution

Added `loadAllEventsWithIds()` to EventLoader, a `rerun()` RPC method on BrainRunnerDO that replays events to find the cutoff point then truncates, fixed the API endpoint to use the existing DO and return `brainTitle`, simplified the CLI to `rerun <run-id> --starts-at N` (no brain identifier needed), and wired up the spec test with proper completion polling.
