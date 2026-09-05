# Runs that die outside the event stream stay "running" forever

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 54764faf

## Goal

Pin down, with failing tests, a class of failure the brain runner has never
reported. When something fails in the runner's dispatch loop (the Monitor DO
rejects an RPC, an R2 write fails, a state-machine reducer throws), the run
dies but no ERROR event is ever written. History shows "running" forever, the
watch stream never ends, and a schedule that triggered the run never learns it
finished. Sean has seen these symptoms before without a cause.

This came out of a discussion about a CLAUDE.md tension: the DO's
fire-and-forget `runner.run(...).catch(...)` is a log-only catch, which the
rules forbid, but removing it brings back the unhandled rejection that the
vitest plugin migration surfaced. The tests come first; the fix is a separate
step.

## Log

### Where the ERROR event actually comes from

The ERROR event is emitted by the `catch` inside the event-stream generator
(`event-stream.ts`). That catch wraps the step loop, so it only sees exceptions
thrown by brain code. `BrainRunner.run` consumes the generator with
`for await`, and adapters dispatch inside that loop body. When an adapter
throws, the exception is in the runner, not the generator. The `for await`
calls the generator's `return()`, not `throw()`, so the generator's catch
never runs. No ERROR event, no terminal anything. `run` rejects, and the only
listener is the DO's catch, which logs.

The rethrow-vs-not question in `BrainRunner.run` is beside the point for this
symptom. The promise is fire-and-forget, so nobody is there either way. That
debate is about hygiene and test noise. The stuck run is about a missing
event.

### Where the fix belongs (first take, later overturned)

The generator keeps its own rethrow, which nested brains and `.map()` error
handlers rely on. My first take was that the DO's catch is the only code that
knows the run died for a reason the generator did not see, so it should
write the terminal ERROR event. That premise was wrong. See "Review pass 1"
below.

### Getting a deterministic failure in the test-project

The failure has to come from infrastructure, not brain code, or the existing
ERROR path handles it. The Monitor DO is a separate Durable Object reached
over RPC, so making it reject one event is exactly the shape of a real
hiccup. Under `@cloudflare/vitest-plugin` the main worker's Durable Objects
run in the test isolate, so `vi.spyOn(MonitorDO.prototype, 'handleBrainEvent')`
reaches the live instance through the RPC stub. Confirmed by the stack trace
in the test output: the throw lands in `MonitorAdapter.dispatch` inside
`BrainRunner.execute`.

The spy restores itself after one throw. That matters for the fix, not the
failing test: if the runner reacts by emitting a terminal ERROR event, the
Monitor has to be able to record it.

### Waiting on a stream that never ends (tests later superseded; the workerd lesson stands)

The bug under test is a watch stream that stays open forever, so the test
needed a deadline. Three attempts to hold the live stream with a deadline all
produced unhandled errors in workerd, even when the test awaited and caught
every rejection itself. Racing `reader.read()` against a timer and then
cancelling: the losing read rejects later, unhandled. Having the timer cancel
the reader while the awaited read is pending: the read rejects into my catch,
and workerd still reports "Stream was cancelled" as uncaught. `pipeTo` with an
AbortSignal: workerd never rejected the pipe on abort at all, the test hit
vitest's timeout, and the abort reasons showed up as unhandled rejections.

The pattern that works, and that every existing test here already follows, is
to cancel a reader only when no read is pending. So the tests stopped holding
a live stream on the failing path. The watch endpoint replays the whole event
log as its first SSE message, which arrives immediately, so `vi.waitFor` polls
that replay for a terminal ERROR event, reading until the first `\n\n` and
cancelling with nothing in flight. That replay is also what a client
reconnecting with `px watch` sees, so the assertion is still user-facing.
The webhook-resume test waits for the WEBHOOK event with the existing
`readUntilEvent` helper, which cancels right after a read resolves.

### Proving the tests can pass

A failing test that can never pass is worthless, so before handing these over
I patched the DO's two catches to build an ERROR event and dispatch it through
the run's adapters, ran the file, and reverted. All four passed. That also
confirms the spy's self-restore works: the Monitor rejects one STEP_COMPLETE
and then accepts the ERROR event the fix emits.

### The fix, first version

Two pieces. In core, `BrainRunner.execute`'s catch got a branch between the
cancel check and the rethrow: if `machine.context.isError` is set, the
generator already emitted ERROR and every adapter saw it, so resolve with
the current state the way cancel does; otherwise rethrow. In the DO,
`prepareRunner` handed back its adapters array and both fire-and-forget
catches called a new `recordRunFailure` that built a terminal ERROR event and
dispatched it to every adapter with `Promise.allSettled`.

Why `isError` on the machine rather than tagging dispatch failures: the
runner feeds every event to the state machine before dispatching it, so by
the time the generator rethrows a brain error the machine is already in the
error state. Distinguishing "generator threw" from "dispatch threw" any other
way means wrapping dispatch errors in a new type, which is the catch-and-
rethrow shape the rules forbid.

### Review pass 1: the runner should write the event, not the DO

The fresh-context reviewer pointed out that the `isError` check is itself
the proof that the runner knows when the generator did not see the failure.
And the runner has everything else too: the adapters, the machine's
`brainRunId`, the options, and `brain.structure` for title and description.
So the ERROR event belongs in `execute`'s catch, right where cancel already
synthesizes its CANCELLED event, and `createErrorEvent` sits next to
`createCancelledEvent`. `run()` and `resume()` then resolve for every kind of
ending, the DO keeps only `.finally`, and the CLAUDE.md tension that started
this whole thing disappears rather than being argued around. Every backend
gets the behavior, not just Cloudflare.

The reviewer also cut the tests down. Three of the four integration tests
were the same Monitor row observed through three endpoints (history, the
running list, and the event log all derive from the same ERROR event), and
the webhook-resume test only proved that a copy-pasted catch was pasted
twice; with the fix in `execute` there is one path. One integration test
against `GET /brains/runs/:runId` remains, and the core test carries the
"every adapter received ERROR" assertion.

What that leaves: `resume()` still throws before entering `execute` when the
execution stack is empty, so `wakeUp()`'s unawaited promise can reject in
that one case. That is an invariant violation (wakeUp on a run with no
steps), not a runtime failure, and workerd logs unhandled rejections, so a
log-only catch would add nothing. Left as is.

If the Monitor rejects the ERROR event itself, `isError` is already set,
`run` resolves, and the Monitor never learns. The run's own log and watchers
still got the ERROR. The fallback would have been retrying the same broken
Monitor, so not worth the machinery.

The core test "should handle brain errors" had a try/catch around `run` with
an empty catch, which is why the old rethrow was never pinned down either
way. It now awaits `run` directly and asserts the resolved state.

### Review pass 2: nested brains, and less code

Two things worth keeping from the second fresh-context pass.

The first version of the runner fix emitted one synthesized ERROR event. That
is wrong whenever the dispatch failure happens inside a nested brain. The
state machine (and the Monitor DO keeps its own copy of it) routes an ERROR
at depth greater than one to `completeInnerBrainError`, which pops the inner
brain and stays `running`. So the outer run would have been stuck exactly as
before, and the integration test only passed because it injected the failure
on a top-level step. The fix mirrors what the event stream already does when
brain code throws inside a nested brain: one ERROR per brain on
`machine.context.brainIdStack`, innermost first. A core test replays the
dispatched events through a fresh machine and asserts it ends in error.

The rest was fat. Feeding the synthesized ERROR into the runner's own machine
was inert (nothing reads the machine afterwards) and at depth greater than
one would have popped the wrong brain. The `allSettled` plus a loop that only
logged was the same log-only shape the DO catch had, one layer down; the
dispatch of terminal events now uses the same `Promise.all` the cancel path
always has, through one shared `dispatch` closure. If an adapter cannot even
receive the terminal event, `run` rejects, which for the DO's fire-and-forget
call becomes an unhandled rejection that workerd logs. That is the one case
`run` still rejects, and it is the right signal for it. `createErrorEvent`
takes a brain title where `createCancelledEvent` hardcodes an empty one; the
CANCELLED transition is not guarded by depth, which is the whole reason ERROR
needs the per-brain loop and CANCELLED does not. `packages/core/CLAUDE.md`
now describes the new contract (two bullets there said the opposite).

### Review pass 3: reason from what consumers saw, not from the runner's machine

The runner feeds each event to its machine before dispatching it. So when a
dispatch throws, the runner's machine is one event ahead of every consumer.
Checking `machine.context.isError` to decide whether to synthesize was
therefore wrong in the case most likely to happen in practice: the adapter
that fails is the one dispatching the generator's own ERROR event. The
machine already says error, nothing is synthesized, and the Monitor never
hears. Same problem one level down: if the failed dispatch was an inner
brain's ERROR, the runner's machine has already popped that brain, so a
loop over its stack emits one ERROR too few and the consumer, still at the
deeper level, treats it as an inner error and stays running.

The fix is one snapshot: after each successful dispatch, record the machine's
`isError` and `brainIdStack`. That is exactly the consumers' view. Synthesis
reads from the snapshot. It also deleted two fallbacks: the
`brain.structure.title` path (only reachable when START was never delivered,
in which case consumers are in `idle`, which has no ERROR transition, so the
event would be inert; and `structure` walks every block to compute) and the
explicit `brainRunId` parameter (START sets it on the machine). The earlier
"not worth the machinery" note about the Monitor rejecting the ERROR event is
now moot; that case is covered, and a core test pins it.

## Learnings

- `for await` over an async generator calls `return()` on the generator when
  the loop body throws. The generator's `catch` never sees it. Anything the
  generator does in a `catch` (like emitting ERROR) will not happen for
  failures in the consumer.
- Prototype spies on Durable Object classes work under the vitest plugin and
  intercept RPC calls from other DOs, because the main worker's DOs share the
  test isolate.
- The current `console.error` in the DO's catch fires for every ordinary
  brain error too, so in production logs a real infrastructure failure looks
  identical to a user's step throwing.

- In workerd, cancelling a ReadableStream reader while a `read()` is pending
  produces an "Uncaught (in promise)" report that no JS-level try/catch
  prevents. `pipeTo` with an AbortSignal does not reject on abort. Only
  cancel with nothing in flight.

## Dead ends

- Holding the live watch stream with a deadline, three ways (race a timer,
  cancel from the timer, `pipeTo` with abort): all leave workerd reporting
  unhandled rejections. Poll the replay chunk instead.

## Solution

`BrainRunner.execute` owns how a run ends. Its catch already synthesized a
CANCELLED event on abort; it now also synthesizes ERROR events when the
failure happened outside the brain's event stream (an adapter's `dispatch`
rejecting, a reducer throwing), one per brain on the nesting stack, innermost
first, and resolves with the current state in every case. The Cloudflare DO
dropped both log-only catches from its fire-and-forget `run` and `resume`
calls and keeps only `.finally`. One core test pins the top-level case, one
pins the nested case by replaying the events through a fresh state machine,
and one Cloudflare integration test makes the Monitor DO reject a
STEP_COMPLETE over RPC and asserts the run ends as errored.

This won over emitting the event from the DO's catch because the runner is the
only place that has the discriminator (`machine.context.isError`), the
adapters, the brain stack, and the run id all together, and because every
backend gets the behavior rather than only Cloudflare. It also dissolves the
CLAUDE.md tension that started the discussion: there is no catch left to argue
about.
