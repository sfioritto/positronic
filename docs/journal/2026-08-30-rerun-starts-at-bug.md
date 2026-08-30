# rerun --starts-at investigation

**Status:** active
**Started:** 2026-08-30

## Goal

Sean reported that `px rerun <run-id> --starts-at=12` "doesn't seem to work
properly" and asked for a failing spike test, probably at the CLI level.
Figure out where the option breaks down and pin it with a test.

## Log

### Spike 1: CLI level — passes

Added a CLI test using the exact `--starts-at=12` (equals-sign) syntax.
Yargs parses it fine, the component sends `{ runId, startsAt: 12 }` to
`POST /brains/runs/rerun`, and the mock server receives the number 12.
The CLI layer is not the problem.

### Spike 2: backend happy path — passes

The existing spec test for rerun only asserts the endpoint returns 200 with
the same run ID — it never verifies _which_ steps re-execute, so any
starts-at bug hides behind it. Added `rerun-test-brain` to the cloudflare
test-project: 4 steps, each recording an execution count in a module-level
counter, so a test can distinguish "step kept from original run" vs
"step re-executed" (state alone can't — the steps are deterministic).
Rerun from step 3 correctly kept steps 1–2 (count 1) and re-executed
steps 3–4 (count 2). The core truncate-and-resume machinery works.

### Spike 3: starts-at out of range — FAILS (the bug found)

`BrainRunnerDO.rerun()` counts top-level STEP*COMPLETE events while
replaying, and breaks when it reaches `startsAt - 1`. If the log holds
\_fewer* completed steps than that, the loop just runs out and
`cutoffEventId` silently stays at the START event — so the entire brain
reruns from step 1, returning 200 as if everything were fine. The failing
test asserts a 400 and no re-execution; today you get 200 and a full rerun.

This plausibly matches what Sean saw: ask for step 12, watch it start over
from step 1 — e.g. if the run completed fewer top-level steps than expected
(errored midway), or if his mental step numbering (from the brain
definition) diverges from the top-level STEP_COMPLETE count in the log
(nested brains, loops).

## Learnings

- The spec rerun test's assertions are shallow (status code + run ID), so
  behavioral rerun bugs sail through. The instrumented-counter brain pattern
  (module-level execution counts surfaced into state) is the way to observe
  re-execution, since vitest-pool-workers runs the DO in the same isolate as
  the test module.
- `rerun()` in brain-runner-do.ts has no upper-bound validation on
  `startsAt`; the API only validates `>= 1`. The "not found" fallthrough
  is a silent full rerun — the worst possible default for a destructive
  operation.

## Dead ends

- Suspected yargs parsing of the `--starts-at=12` equals syntax (vs the
  space-separated form the existing tests use). Both parse identically;
  camel-case expansion gives the handler `argv.startsAt` as a number.

## Open questions

- Does Sean's actual brain have ≥ 12 top-level completed steps in the run
  he rerun? If yes, there's a second bug (likely in step counting with
  nested/loop steps) that these spikes don't reproduce yet — need the real
  brain shape or the run's event log to chase it.

## Solution

Sean chose rejection over clamping (right call for a destructive op).
`BrainRunnerDO.rerun()` now replays the whole log to count completed
top-level steps, and returns `{ success: false, error }` before touching
anything when `startsAt > completed + 1`; the endpoint maps that to a 400.
Valid max is `completed + 1` on purpose — that's "retry from the point of
failure" for a run that errored midway.

Two design decisions worth remembering:

- **`prepareForRerun` moved from the endpoint into the DO.** The endpoint
  used to reset MonitorDO _before_ asking the DO to rerun, so a failed
  validation would still have wiped the monitor's events and flipped the
  run status to RUNNING. Rerun is now atomic in the DO: validate → reset
  monitor → truncate → wake up. Side effect: the spec test's
  "status is not complete right after the POST" assertion died — with a
  fast brain the rerun finishes again before the next fetch. That
  assertion was always a scheduling accident; replaced with "completes
  again" + the deterministic out-of-range check (status _stays_ complete).
- **Validation-failure signaling uses a result object, not a thrown
  error.** Thrown errors over DO RPC only carry a message, and the
  endpoint would have to string-match to tell a 400 from a 500. The
  `{ success, error }` shape follows the existing `cancel()` pattern.

Also learned: right after a rerun completes, the DO's `abortController`
clears in the resume promise's `.finally()`, which lags the monitor
seeing COMPLETE — so an immediate second rerun can 500 with "actively
running". Pre-existing window, just narrow; the spec test now does its
out-of-range check before the valid rerun to stay out of it.

The user-facing contract is pinned at every level: CLI test asserts the
error message renders (BrainRerun now parses 400 bodies like 404s),
TestDevServer mirrors the contract, spec has `rerunOutOfRange`, and the
test-project has behavioral tests with the instrumented-counter brain.
