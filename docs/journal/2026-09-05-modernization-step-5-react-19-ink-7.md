# Modernization step 5: React 19 and Ink 7 in the CLI

**Status:** shipped
**Started:** 2026-09-05
**Shipped:** 2026-09-05
**Commit:** 171d0848

## Goal

Fifth step of the modernization plan. The CLI pinned React 18.3 while shipping `@types/react` 19, and Ink 5 was two majors behind. Ink 7 needs React 19.2. Bump them together in the CLI, give gen-ui-components the same React, and fix whatever the two majors change.

## Log

### 2026-09-05 — the bump was easy; the test harness is where the two majors bit

**What we did.** React 19.2.8 and Ink 7.1.1 in the CLI, React 19 in gen-ui-components (its unused `react-dom` devDependency dropped), `@types/react` 19 in the project template. No source changes. Everything else is in the CLI test harness, `packages/cli/tests/test-utils.ts`, plus three tests that assert on a transient frame.

**npm kept Ink 5 at the root.** After the bump, `npm ls` showed Ink 7 and React 19 nested under `packages/cli/node_modules` while the root still held Ink 5, React 18, and react-reconciler 0.29. The root copies were `peer: true` placeholders arborist had created for `ink-text-input`'s peer range and would not give up: `npm dedupe`, `npm update`, and uninstall-then-install all left them. Two Inks in one process means two reconcilers, and `TextInput` would have rendered into the wrong one. Deleting those lockfile entries by hand and reinstalling put Ink 7 at the root, where `ink-text-input`'s `ink >=5` peer now resolves to it. `npm ls` shows one copy of each.

**Effects no longer flush before `render()` returns.** Under Ink 5 with React 18, a component's `useEffect` from its first render had run by the time the test harness got the instance back, so tests could read `instance.lastFrame()` synchronously and see the loaded state. Under Ink 7 with React 19 the passive effects flush on a later task, and a probe showed the latency at 20 to 50 milliseconds through the real CLI path. Eight tests in `project.test.ts` read the frame synchronously and got the pre-effect "No projects configured" state; others polled for 100 milliseconds and lost the race under load. React's own answer is `act()`, which React 19 exports from `react` and which works with any reconciler-based renderer, Ink included. The harness now runs the CLI parse inside `act()` with `IS_REACT_ACT_ENVIRONMENT` set for its duration, so every effect of the initial render, and every state update those effects cause, has been applied when `px()` resolves. That is deterministic, not a delay.

**Ink 7 writes a newline when the app unmounts.** Five `brain run` tests timed out on an empty last frame even though the Run ID had rendered. Non-watch runs call `exit()` once they have the ID, and Ink 7 in non-interactive mode writes a bare `\n` to stdout on unmount (its comment: "in debug mode, each render already writes to stdout, so only a trailing newline is needed"). ink-testing-library records every stdout write as a frame, so the last frame became `\n`. Ink 5 wrote nothing there. Ink 7's new `interactive` option avoids the newline but writes a show-cursor escape instead, so the artifact moves rather than disappears, and ink-testing-library hardcodes its render options anyway. The harness's `lastFrame` now returns the last frame that is not that newline.

**Loading states are now too fast to see.** With effects flushed inside `act()`, three tests that assert a "Loading..." or "Checking..." frame before an error found the error already on screen. The first fix made `waitForOutput` match against every frame rendered so far; the reviewer pointed out that this turns "the UI shows X" into "the UI showed X at some point" for the other hundred-odd callers, so a success frame later replaced by an error would still pass. `waitForOutput` keeps its meaning, and the three tests look at the frame history inline, which is what they are actually asserting.

**Keypresses can arrive before Ink is listening.** One watch-mode test failed once in a full run and passed three times alone: it waits for the footer that says `e events`, writes `e` to stdin, and waits for `b back`. The footer frame is written during React's commit; Ink's stdin subscription is a passive effect of that same render and runs on the next task under React 19. If the poll lands right after the commit, the keypress is emitted before anyone listens and is lost. `waitForOutput` now yields one task after a match so the matched render's effects have run before the test acts on it. Under React 18 the effects were already applied by the time the frame was visible, which is why this never showed before.

**The interactive commands still need a hand.** `brain watch`, `server`, and the select lists use raw-mode input that neither ink-testing-library nor this tool shell (no TTY) can exercise. The plan asks for those to be run by hand.

## Learnings

- npm 12 will not dislodge a `peer: true` placeholder at the root even when the package that needs the peer would accept the newer version. `npm dedupe` and `npm update` both leave it. Delete the lockfile entries and reinstall.
- React 19 defers passive effects from a legacy-root render to a later task; React 18 with Ink 5 had them applied before `render()` returned. Any harness that reads output synchronously after render needs `act()`.
- `act()` from `react` works with Ink. Set `IS_REACT_ACT_ENVIRONMENT` only for the duration of the call, or React warns about every later update the mock server triggers.
- Ink 7 writes to stdout on unmount in both modes: a newline when non-interactive, a show-cursor escape when interactive. A frame recorder that captures raw writes sees a trailing non-frame either way.
- A frame being visible does not mean the render's effects have run. Under React 19 a test that writes to stdin right after seeing output must yield a task first, or Ink's `useInput` subscription is not attached yet.
- Ink 7 maps both byte 127 and byte 8 to `key.backspace` and reserves `key.delete` for forward Delete. The paste input's `key.backspace || key.delete` check keeps working and keeps forward Delete erasing, so it stays.
- The `MaxListenersExceededWarning` for SIGINT and SIGTERM in the CLI suite predates this step. Each Ink instance registers a signal-exit handler and the tests leave instances mounted.

## Dead ends

- Making `lastFrame` robust by switching to Ink's `interactive: true` mode. The newline goes away and a cursor escape takes its place. Filtering one known write is smaller than replacing ink-testing-library with a local render helper.
- Fixing the timing by raising `waitForOutput`'s retry count. It would have masked the sync reads and the exit newline, and the effect latency varies with load.

### 2026-09-05 — review loop, pass 1

The reviewer agreed with `act()` (the alternative is rewriting a couple of dozen synchronous frame reads) and with the task yield. Taken: `waitForOutput` back to matching the last frame, with the three transient-frame tests reading the history inline; one `lastFrame` helper shared by the wrapper and the failure log, which had still been printing the raw newline frame; the act environment flag restored to its previous value rather than reset; and the `key.delete` change reverted, since Ink 7 still reports Backspace as `key.backspace` and the old check also covered forward Delete. Declined: root `overrides` for react, ink, and `@types/react` (the ranges all resolve to one installed version now; overrides are a heavier tool than the problem needs); a comment in `generate-page-html.ts` about its React 18 UMD pin (recorded below instead); core declaring its own `IntrinsicElements` so the template stops needing `@types/react`.

### 2026-09-05 — review loop, pass 2

The second pass called the diff close to minimal and confirmed the harness changes against Ink's source. Taken: the CLI's `@types/react` range moved to `^19.2.18`, since Ink 7's peer floor is 19.2 and the old `^19.1.3` only satisfied it by luck; the newline filter narrowed to the trailing write it documents (`at(-1)`, else `at(-2)`) instead of skipping any newline frame in the history; and `rerender`, `stdout`, and `stderr` dropped from the harness result, which nothing used and which exposed ink-testing-library's unfiltered `lastFrame`. On the task yield: the reviewer worried that React's scheduler might use `MessageChannel`, which is unordered against `setImmediate`. In Node the `scheduler` package picks `setImmediate` first, so the yield lands after React's effect task in the same check phase.

Declined: `@types/react` as an optional peer of core so the template stops carrying it, and `react` as a peer of gen-ui-components. Both are real packaging points and both belong to step 7, where the React 18 UMD pin for generated pages has to be part of the same decision. Also declined: a guard that fails the suite if two Inks are installed; step 7 can weigh that against root `overrides`.

## Leftovers

- gen-ui-components lists `react` as a devDependency while its `dist` imports `react/jsx-runtime` at runtime. The scaffolded project's esbuild config marks `react` and `react-dom` external. Whether `react/jsx-runtime` is covered by that and whether `npm run build:components` still works in a fresh project is worth checking in step 7, and the right shape is probably a peer dependency.
- `packages/core/src/ui/generate-page-html.ts` loads React 18 UMD bundles from unpkg for generated pages. React 19 ships no UMD build, so that pin cannot follow this bump; the gen-ui components are typechecked against React 19 and run in the browser on React 18.

- `packages/cli/src/hooks/useAlternateScreen.ts` writes the alternate-screen escapes itself. Ink 7's `render()` has an `alternateScreen` option that does the same. The hook is per-component (watch mode turns it on), so moving it means passing the option at the render call sites that want it.
- Ink 7 adds `usePaste` with bracketed paste. The SSH key paste input in `users-keys-add.tsx` assembles pasted text from individual keystrokes and could use it.
- The CLI tests leave every Ink instance mounted, which is where the listener warning comes from.
- Nothing enforces one Ink in the tree. `ink-testing-library` declares no `ink` peer, and the fix this step was a hand-edited lockfile. Root `overrides` or a check in the test setup would make a second copy fail loudly; step 7.
- `packages/core` publishes declarations that import React types but lists `@types/react` only as a devDependency, which is why every scaffolded project carries its own. An optional peer on core would remove that template line for good; step 7.

## Solution

React 19 and Ink 7 in the CLI with no source changes. The test harness owns the three timing differences the majors introduced: `act()` around the CLI parse, Ink's unmount newline treated as not a frame, and a one-task yield after a matched frame so keypresses land after Ink is listening.
