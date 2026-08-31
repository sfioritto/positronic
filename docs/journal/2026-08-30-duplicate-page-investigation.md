# Suspected duplicate .page() on inner-brain webhook resume — investigation

**Status:** shipped
**Started:** 2026-08-30
**Shipped:** 2026-08-30
**Commit:** b0bf66a (last of four: 090b31b wakeUp param, c143d9d prepareForRerun, edd5e17 form defaults, b0bf66a currentResponse)

## Goal

Sean reported that an inner brain's `.page()` step (ynab-categorizer →
amazon-match-review) created its page twice on webhook resume: two pages
(`page-2173b262-72nmz6a1` @ 13:47:44, `page-2173b262-zkynzc9f` @ 13:53:23),
double ntfy, and a DO event log showing one `brain:webhook` but two
`brain:webhook_response` events. Suspicion was that the inner-brain resume
path replays the page-creation block. Figure out what actually happened.

## Log

### Reading the real DO event log instead of the summary

The live sqlite (`seans-bots` project, DO
`2173b262…`) tells a different story than the reported tail. Key facts the
summary missed:

- **Event ids 447–455 are deleted** (log jumps 446 → 456). Only one thing in
  the codebase deletes event rows: `rerun()`'s truncation. `--starts-at=12`
  → stepsToKeep=11, and event 446 is _exactly_ the 11th top-level
  `step:complete` — the cutoff. Sean ran `px brain rerun --starts-at=12` on
  this run at 13:53:23, which truncated 447–455 and re-executed step 12.
- **The two pages belong to different steps.** Pulled both HTML blobs from
  miniflare R2: `72nmz6a1` is `<title>Review transactions</title>` (the
  _outer_ page step, suspended at event 430, 13:47:44); `zkynzc9f` is
  `<title>Review Amazon matches</title>` — the only Amazon page ever
  created. **There is no duplicate-page bug.** The two ntfy messages came
  from two different steps' `onCreated` (both mention "Amazon" in their
  text, hence the confusion).
- **The two `brain:webhook_response` events are by design.** On resume of a
  suspended inner brain, the outer stream consumes the signal and emits one
  (468), then re-emits it into the inner stream's event flow (471) so the
  inner state machine transitions waiting→running. The 13:57:02 resume
  applied the form response to the inner page step cleanly — the
  innerStack/webhookResponse propagation path in `event-stream.ts` works
  correctly.

### Timeline reconstruction (UTC = local + 5)

1. 18:46:06 run starts; 100-item map does its alarm/PAUSE restart dance.
2. 18:47:44 outer "Review transactions" page created + suspend (event 430).
3. 18:52:07 Sean submits that form → resume runs steps 8–10, enters the
   inner brain, emits up to `step:start "Review Amazon matches"` (event
   455)… **and dies silently.** No error event, no page in R2, no webhook.
4. 18:53:23 `rerun --starts-at=12` truncates the dead partial execution
   (447–455) and re-executes step 12 → creates the Amazon page + ntfy →
   suspends (467). This is correct destructive-rerun behavior.
5. 18:57:02 Sean submits the Amazon form → clean resume → run completes.

The silent death at step 3 is the one genuinely unexplained event. Most
likely the dev server reloaded/restarted around 18:52 (Sean was iterating
on `render-html.ts`; a workspace rebuild reloads wrangler and kills the
fire-and-forget resume promise mid-await). Needs confirmation from Sean.

## Learnings

- **Real bug found: `wakeUp()` hands the wrong brainRunId to services.**
  `alarm()` and `rerun()` call `this.wakeUp(this.brainRunId)` where
  `this.brainRunId = state.id.toString()` — the DO _hex_ id, not the run
  UUID. `wakeUp()` carefully derives `originalBrainRunId` from the START
  event for the runner, but passes the raw parameter to `prepareRunner()`,
  so `createPages()` and `createFiles()` get the hex id. Proof: both pages
  from this run have slug prefix `page-2173b262-…` and R2 metadata
  `brainRunId=2173b262…` instead of the run UUID `9d225385-…`.
  Consequences: PageAdapter cleanup (keyed by run UUID) can never find
  these pages, and `run`-scoped files written after an alarm/rerun resume
  land under a different key than files written before suspension.
  Fix: pass `originalBrainRunId` into `prepareRunner()`.
- **A killed fire-and-forget resume leaves a run stuck in RUNNING with no
  trace.** The DO's `runner.resume(...)` promise isn't awaited or
  registered anywhere; a dev-server reload (or eviction) mid-step persists
  nothing — not even an error — and the monitor still says running. The
  event log just… stops. Robustness gap worth designing for eventually.
- When diagnosing "duplicate" behavior from an event log, check for
  **gaps in event ids** first — a mid-log gap means truncation happened,
  and the log you're reading is not the history you think it is.
- Miniflare local state is fully inspectable: DO sqlite under
  `.wrangler/state/v3/do/<script>-<class>/<hex>.sqlite`, R2 object
  metadata in `.wrangler/state/v3/r2/miniflare-R2BucketObject/*.sqlite`,
  blobs under `.wrangler/state/v3/r2/<bucket>/blobs/`. Cross-referencing
  event timestamps with R2 `createdAt` metadata settled this in minutes.
- Confirmed adjacent finding: `.brain()` without `config.initialState`
  starts the inner brain with `{}` (event-stream.ts, brain branch), not
  the outer state — separate issue, still open.

## Dead ends

- Chased the reported theory (inner-brain resume replaying the page block)
  through `event-stream.ts` / `brain-state-machine.ts` / `brain-runner.ts`
  first. The replay→executionStack→innerStack→webhookResponse path is
  actually correct; tracing it predicted the exact persisted event
  sequence 468–477, which is what pointed to the log itself being the
  anomaly rather than the resume code.

### The Beth-email bug turned out to be the same investigation's real prize

Sean separately reported the ynab-categorizer "Questions for Beth" email
sometimes never sends, seemingly when Amazon transactions exist. Root cause
(in core, not the brain): on resume, the outer event stream sets
`currentResponse` from the WEBHOOK*RESPONSE signal so the waiting step can
consume it. When the suspension was inside an \_inner brain's* page step, the
inner stream consumes its own copy — but the outer stream's copy was never
cleared. The next outer `.page()` step (`Questions for Beth`) then saw a
stale `currentResponse` + its own formSchema and took `executePageStep`'s
resume branch: it "completed" silently — no page created, no `onCreated`, no
email — and `Apply Beth decisions` ran with `bethDecisions: []` (the Amazon
response coerced against Beth's schema). Exactly matches the correlation:
with no Amazon matches, the inner brain never suspends, so no stale
response, and the Beth page works.

Smoking-gun evidence: runs 625f5c2e and e6e0c509 have a "Questions for
Beth" `step:complete` with an **empty patch** seconds after the Amazon form
submission, followed by `brain:error TypeError: bethDecisions is not
iterable` — the runs actually ERRORED at the end. (9d46a602 turned out to be
a healthy run: its Amazon guard skipped the inner page, and a real Beth
submission came through.)

The crash exposed a third core bug: `coerceFormResponse` fills in missing
array fields only when `!fieldSchema.isOptional()`, but zod's `.default([])`
makes `isOptional()` return true — so `z.array(...).default([])` fields
missing from a form submission stay `undefined` on state instead of
becoming their default. That crashes any healthy flow too (submit a form
with nothing selected → every `.default([])` key absent → downstream
`for...of undefined`).

Operational fallout, corrected after checking YNAB via the API: the blue
flags are NOT set on the three Beth transactions (Target −$81.94,
Target −$47.09, "Roe 99 Elis Applicatio" −$51.13) — they're unflagged and
unapproved, so the next run re-triages them; no manual cleanup needed.
Which raises an unresolved puzzle: the same PATCH that verifiably applied
the run's two category choices also carried the three `{id, flag_color:
'blue'}` entries, and a purple flag-only update for the Amazon split's
original is missing too — every flag-ONLY entry silently didn't stick,
while every flag+category+approved entry did. Sean ran the decisive test: a
flag-only PATCH **works fine** (074d0ec9 went blue and read back blue). So
YNAB does not ignore flag-only updates — the bot's PATCH set the flags at
22:51:39, and something OUTSIDE the bot cleared them before ~23:10 (no
later runs exist, and the only flag-clearing code path crashed before
writing). Leading suspects: a manual YNAB UI action (Undo was active in
Sean's session per his screenshot), a mobile/second-device edit, or a
shared-budget user. Left with Sean to confirm; the brain's flag mechanism
itself is sound.

### Code-review loop reshaped the solution (still 2026-08-30)

Ran the iterative fresh-context review loop over the uncommitted fixes (two
passes). The reviewer's best catch: the original wakeUp fix was routing
around the bug instead of deleting it. `wakeUp(brainRunId)` derives the run
UUID from the START event anyway — the parameter only fed a dead fallback
(START events always carry `brainRunId`) and log strings, and two of five
callers passed the DO hex id. Dropping the parameter entirely makes the bug
class unrepresentable and let ~130 lines of bespoke test scaffolding
(new test file + `wakeupPageBrain` + manifest entry) collapse into one test
in `rerun.test.ts` reusing `auto-slug-brain` — driving the exact production
path (rerun) that produced the original symptom.

Pass 2 also caught a live cousin the fix had walked right past:
`rerun()` called `monitorStub.prepareForRerun(this.brainRunId)` — the DO hex
id — but MonitorDO keys on the run UUID, so the monitor reset silently
matched zero rows. Pre-existing in HEAD; fixed with the UUID from the
already-loaded START event.

One reviewer suggestion was rejected on a false premise worth recording:
"assert post-rerun event ids instead of the page slug." Events always
carried the correct UUID even in the buggy code — only the pages/files
services got the hex id. The page-attribution assertion IS the invariant,
not a proxy for it.

Also declined (deliberately, not lost): whole-schema `formSchema.safeParse`
in coerceFormResponse (strips unknown keys + adds coercions — behavior
change, its own pass, same as the root-cause note below), and the
capture-and-clear refactor for `currentResponse` (same reasoning as the
latent cousin note below).

## Solution

Three small fixes plus one review-loop bonus, all with regression tests:

- **coerceFormResponse ignores `.default()`** — `parse-form-data.ts`: for a
  missing array field, ask zod directly via `fieldSchema.safeParse(undefined)`:
  reject → `[]` (required), fills a value → the declared default, accepts
  undefined → left absent. Tested as a `coerceFormResponse` unit block in
  `brain-ui.test.ts` (it's a pure exported function; the page-step wiring
  was already covered by the adjacent array-coercion test).

- **Stale currentResponse (Beth bug)** — `event-stream.ts`, brain-block
  branch: when forwarding resume context to an inner brain, also clear
  `this.currentResponse` (the response belongs to the step inside the inner
  brain). Test: "creates the later outer page instead of consuming the
  inner page's webhook response" in `brain-ui.test.ts` — verified to fail
  with the fix removed.
- **wakeUp brainRunId** — `brain-runner-do.ts`: `wakeUp()` takes no
  parameter at all; it derives the run UUID from the START event and hands
  that to both the runner and `prepareRunner()` (pages/files services). All
  five call sites updated. Test: "attributes pages created after rerun to
  the original run UUID" in `test-project/tests/rerun.test.ts`.
- **prepareForRerun got the DO hex id** (found by the review loop,
  pre-existing in HEAD) — `rerun()` now passes the START event's run UUID so
  MonitorDO's rerun reset actually matches rows instead of silently no-oping.

Latent cousin NOT fixed (deliberately, to keep scope tight): a regular step
(`.handle`) also never clears `currentResponse` after consuming it, so a
`.wait()` → `.handle()` → later `.page()` sequence in a _flat_ brain could
hit the same swallowing. Changing that touches the documented "response is
available after the wait" semantics — worth its own pass.

Pre-existing typecheck failures observed while validating (not from this
work): `brain-map.test.ts` `mockImplementation()` arity (2 errors, present
on clean tree) and test-project `webhooks/trigger-*.ts` zod version
mismatch.
