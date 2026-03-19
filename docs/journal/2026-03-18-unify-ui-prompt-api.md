# Unify `.ui()` and `.prompt()` step APIs

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-19

## Goal

The `.ui()` step's API was inconsistent with `.prompt()`: it used `responseSchema` (bare Zod object) instead of `outputSchema: { schema, name }`, and required `.handle()` for form responses instead of auto-merging onto state.

## Log

### responseSchema → outputSchema with auto-merge

The `.ui()` step previously used `responseSchema: z.ZodObject<any>` (bare schema) while `.prompt()` used `outputSchema: { schema, name }` (named schema). Unified to the named pattern.

The auto-merge was the interesting design question. `.prompt()` auto-merges synchronously in its step action because the LLM call happens in the same step. But `.ui()` **suspends** — the brain yields a WEBHOOK event and the form response arrives on resume.

### First approach: hidden step block (rejected)

Initial implementation pushed a hidden step block after the UI block that did `{ ...state, [name]: response }`. This reused the existing `.handle()` machinery (continuation.ts just pushes a step block too). Problem: a phantom step appeared in event streams and logs that users didn't define.

### Final approach: merge inside the UI step itself

The UI step now owns its full lifecycle. On initial execution it generates the page, yields WEBHOOK, and does NOT call `completeStep`. On resume, `executeUIStep` detects `currentResponse` is set, merges the response onto state, and completes the step. The STEP_COMPLETE patch captures the full state including the merge. One step, one completion, no phantom events.

This is the same pattern as how agent steps handle webhook resume — detect context, skip setup, do the work.

### Read-only UI cleanup

Read-only `.ui()` (no outputSchema) no longer creates an unused webhook registration with CSRF token. The form/webhook infrastructure is only created when there's actually a form. Made `webhook` optional on both `GeneratedPage` and `SerializedPageContext` to support this cleanly.

### template stays as template

Initially renamed the `template:` config property to `prompt:` across all DSL methods, but reverted. The method `.prompt()` already claims the word "prompt" — having `prompt:` as a property inside it reads as `.prompt('title', { prompt: ... })` which is redundant. A "prompt" is `template` + `outputSchema`; the `template` is the function that builds the prompt string. Keeping `template:` means zero churn across the codebase and clearer semantics.

## Learnings

- **Steps can span the suspend/resume boundary.** The UI step doesn't complete before WEBHOOK — it completes after resume. This works because on resume, a fresh `BrainEventStream` is created with `currentStepIndex` pointing at the UI step (since there was no STEP_COMPLETE to advance it). The main loop re-enters `executeUIStep`, which detects the resume and handles the merge.

- **`pageContext` on STEP_COMPLETE is still live.** Initially thought it was dead code after the refactor, but the read-only UI → `.wait()` → `.handle()` pattern depends on it. The state machine tracks `currentPage` for resume, and `BrainRunner` passes it through.

- **Don't bundle renames with behavioral changes.** The `template` → `prompt` rename touched ~50 call sites for zero semantic benefit and made the behavioral change (outputSchema + auto-merge) harder to review. Unbundling it was the right call.

## Solution

Two changes:

1. **Rename `responseSchema` → `outputSchema`** in `.ui()` to match `.prompt()`'s `{ schema, name }` shape. `.ui()` overload 1 returns `Brain` instead of `Continuation`.
2. **Auto-merge inside the UI step**: on resume, `executeUIStep` merges `currentResponse` onto state under `outputSchema.name` and completes the step with a patch. No hidden steps, no `.handle()` needed.
