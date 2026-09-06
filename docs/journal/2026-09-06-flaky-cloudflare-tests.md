# Flaky cloudflare test-project tests

**Status:** active
**Started:** 2026-09-06

## Goal

Step 4 of the post-json-render cleanup. Four tests in `packages/cloudflare/test-project` fail intermittently in full runs and pass in isolation, so every red `npm run dev` has to be rerun before anyone believes it. Sean asked for an investigation first, no fixes.

## Log

### Reproduction

Eight unloaded runs (five of the cloudflare suite alone, three of `npm run test:all`) were all green. `test:all` runs the root suite and then the cloudflare suite sequentially, so "full run" load is just the cloudflare suite's own 19 files in parallel workers; the flakes need the machine to be busy on top of that. With a game running on the box, runs 10 through 15 of a 15-run loop failed every time, one to three tests per run. A throwaway diagnostic test with 24 `yes` burners reproduced the timings below. All failures were captured with full assertion output this time.

### Four tests, three mechanisms

**signals.test.ts pause/resume: a sleep that is barely long enough.** The test sends PAUSE and sleeps 2000ms, then expects status `paused`. Control signals are only checked between steps, so the earliest the delayed brain can pause is after its 1500ms first step. Measured: the pause lands 1540 to 1570ms after the signal unloaded and 1630 to 1730ms under load, against a 2000ms budget. Failure is `expected 'running' to be 'paused'`.

**rerun.test.ts (all three tests at one time or another): the run has not settled when rerun is called.** `BrainRunnerDO.rerun()` refuses with "Cannot rerun while brain is actively running" while `this.abortController` is set. That field is cleared in the `.finally` of the fire-and-forget run promise, which settles only after the COMPLETE dispatch's `Promise.all` resolves, that is after the Monitor, Schedule, Webhook and Page adapters' RPC round trips. The test's SSE reader sees COMPLETE the instant the EventStreamAdapter enqueues it (synchronously, the first thing in dispatch) and fires the rerun request straight away. Unloaded the rerun won 5 of 5 times with ~30ms to spare; under load the RPCs lose and the API returns 500. This also explains the "Unhandled Rejection" that accompanies these failures, see below.

**wait-timeout.test.ts sequential waits: a second run started on top of the first.** I first read this as the same class as rerun (Monitor RPC lag), and the Monitor poll did not fix it: after the fix it once reported status `cancelled` with type `brain:resumed`, which the Monitor can only produce when a RESUMED arrives after a CANCELLED. The real cause is in the test: after answering the first webhook it opens a second watch and reads until "a WEBHOOK event", but the stream replays history first and history already holds the first wait's WEBHOOK, so the test queues KILL and calls `wakeUp()` while the resumed run is still executing. Two runs then race for the KILL signal, and the loser's RESUMED lands after the winner's CANCELLED. `readUntilEvent` now takes a predicate and the test matches the second wait's registration identifier.

**iterate-brain.test.ts: a plain 5000ms vitest timeout, not a hang.** `.map()` over 7 items restarts the DO between items: the IterateItemAdapter queues PAUSE and sets an alarm for `Date.now()`, then `wakeUp()` replays every event and rebuilds the runner, including reloading resources from R2. Every timeline recorded under load had all seven inner runs and the final COMPLETE; they took 2.2 to 3.1 seconds with a single test file, with one alarm gap of 800ms. Nineteen files in parallel workers push that past five seconds.

### The common thread

Three of the four tests treat the SSE broadcast as proof that a dispatch has finished, or a wall-clock sleep as proof that a run reached a state. The SSE adapter is the only synchronous adapter; the monitor's status, the run promise settling and the abortController reset all lag it by RPC round trips. The fix for those is to wait for the thing being asserted (a PAUSED event on the stream, the monitor reporting the terminal event, the run settling) rather than for a proxy of it.

### The "Errors 1 error, no failed test" mystery

An error thrown inside a Durable Object RPC method is delivered to the caller and also surfaces as an uncaught exception, through the vitest plugin's invocation wrapper (`test-internal.mjs` `enqueueInvocation`). The runner-failure test's deliberate "Monitor DO unavailable" throw shows up as `uncaught exception` in every single run, and the rerun test's guard throw does the same when it fires. Whether vitest counts it as an unhandled error depends on whether it lands before the file's teardown, which is why yesterday's "1 error" run had no failing test and did not reproduce.

### Ruled out

- Per-file storage isolation and leftover runs. Only three files call `reset()` and the failures do not correlate with it; the failures are all timing inside one test.
- The watch handler's load-history-then-subscribe gap. There is no real await between the SQL snapshot and `subscribe()` unless events overflowed to R2, so nothing can interleave.
- A PAUSE-consumed-by-the-wrong-run race between the old run and the alarm-driven `wakeUp()`. Both read the same signal table, so it is possible in principle, but exactly one run continues either way and no timeline showed a duplicated or missing item.

### Noted for the fix, not a cause of the flakes

The alarm is set during the ITERATE_ITEM_COMPLETE dispatch, before the old run has consumed the PAUSE, so `wakeUp()` can start the next runner while the previous run's `.finally` has not fired. When it does fire it nulls the new run's `abortController`, so a `kill` during an iterate can miss the live run. `prepareRunner()` also reloads all resources from R2 on every item restart, which is most of the per-item cost.

### Candidate fixes (none applied)

- signals: wait for the PAUSED event on the watch stream, or poll the run status with `vi.waitFor`, instead of sleeping.
- rerun and wait-timeout: make the DO's notion of "settled" observable, for example have `rerun()` await an in-flight run promise when the last persisted event is terminal instead of throwing, and have the test wait for the monitor to report the terminal event. Returning a result from `rerun()` instead of throwing would also stop the uncaught-exception noise.
- iterate: raise that test's timeout, and separately look at making item restarts cheaper.

### The fix

Two test-side changes and one product change, plus a timeout.

- signals and wait-timeout now poll the asserted state with `vi.waitFor` (the pattern runner-failure already used): the run's status from the Monitor, and the Monitor's last event. Waiting for PAUSED on the watch stream was the first idea, but the resume endpoint reads the Monitor too, so a stream-based wait would just move the same race one assertion down.
- `BrainRunnerDO.rerun()` no longer refuses on the bare presence of a run. It replays the history first (it already did that to find the cutoff) and, if the replayed machine is terminal, awaits the in-flight run before truncating; only a run with no terminal event is "actively running". The DO now keeps the run promise (`activeRun`) for that. The alternative of clearing `abortController` earlier was wrong: nothing before the last dispatch resolving is a safe point.
- The `.finally` that clears `abortController` and `activeRun` now checks that the fields still belong to that run. This fixes the side finding above: the iterate restart's alarm fires while the previous run is still dispatching, so the old run's `.finally` used to fire after the new run had already been tracked and wiped its handle.
- iterate-brain gets a 20 second timeout with a comment saying why. Making item restarts cheaper is a separate piece of work.

The first loaded rerun after those changes passed every test ten times out of ten but still reported "Errors 1 error" twice: `EnvironmentTeardownError: Closing rpc while "resolve" was pending`, attributed to brain-kill.test.ts. Two kill tests start the delayed brain, kill it after 100ms and end. Killing aborts the run, but the runner only checks the abort signal between events, so the 1.5s step keeps going and the CANCELLED dispatch lands after the test, sometimes after the file's environment is gone. Those tests now watch the run until CANCELLED and poll the Monitor for the cancelled status, which also turned the old "status might still be RUNNING" comment into a real assertion.

Verified by rerunning the suite ten times with 24 `yes` burners, the same load that failed six runs out of six before.

### Code review loop

A fresh-context reviewer (simplification pass) reshaped the diff:

- The DO kept two parallel fields, `abortController` and `activeRun`, with two identity guards and a paragraph explaining why they agree. One `active: { run, abort }` field makes that structural: `track()` is the only writer, and `prepareRunner()` no longer owns lifecycle state.
- The rerun guard's three negated flags refused a paused or waiting run whose promise had not settled, which is exactly the case where rerun should wait. `machine.context.status === STATUS.RUNNING` is the actual condition.
- Three copies of "poll the Monitor with `vi.waitFor`" became `waitForRunStatus()` in `sse-helpers.ts`, polling the Monitor DO by RPC instead of through auth + `worker.fetch` + execution contexts on every iteration.
- A config-level `testTimeout: 20000` replaces the per-test number, since `iterate-options` and `pages` restart DOs the same way and would trip next.

A second pass caught my own mistake from the first: I had declined replacing the kill tests' stream wait with a Monitor poll on the grounds that `kill()` writes CANCELLED to the Monitor itself. It does, but only for a suspended brain; for an actively running one it aborts and returns early, and the CANCELLED the Monitor sees comes from the runner's own dispatch after the step finishes. So the Monitor poll is the right wait there too and the extra stream helper went away. Rerunning under load after that change turned up the real wait-timeout cause described above, which no review pass could have seen in the diff. The same pass also caught a design comment in api-error.test.ts that still quoted the old `.finally`. Its other points reversed the first pass (two fields instead of one, a per-file timeout instead of config), so the loop stopped there.

Declined deleting the kill tests' 100ms sleeps as "pointless": the create request returns before the START event reaches the Monitor by RPC, and `kill()` looks the run up there, so those became a wait for `running` rather than nothing. Also declined a separate commit plus a test for the abort-controller identity guard: the window is the previous run's last RPC round trip, which no test can hit deterministically, and the guard is two lines in code this change already rewrites. And the reviewer's suggestion to leave the rerun race to the tests: a user who sees COMPLETE in `px watch` and reruns immediately hits the same race, so the wait belongs in the DO.
