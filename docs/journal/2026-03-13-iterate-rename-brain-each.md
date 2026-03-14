# Iterate: Replace Batch Prompts + Add Brain-Each Support

**Status:** active
**Started:** 2026-03-13

## Goal

The existing "batch prompt" system processes lists of items through an LLM using chunked `Promise.all` with a semaphore for concurrency control. This is unnecessarily complex because the governor (rate limiter) already serializes API calls. The chunking only served as a checkpoint mechanism for pause/resume, but checkpointing per-item is strictly better — more granular, simpler code.

Phase 1 simplifies the loop and renames everything from "batch/chunk" to "iterate/item" terminology. Phase 2 (future) adds the ability to run a brain (nested brain or agent) over a list of items.

## Log

### Phase 1: Rename + Simplify

Key decisions for this phase:

1. **Delete `createSemaphore` entirely** — the governor already rate-limits API calls, so the semaphore was redundant complexity
2. **Replace chunked `Promise.all` with flat per-item `for` loop** — simpler, easier to reason about, and each item becomes a checkpoint
3. **`ITERATE_ITEM_COMPLETE` events are per-item, not per-chunk** — this is the core semantic change. The event payload changes from `chunkStartIndex`/`chunkResults` (array) to `itemIndex`/`item`/`result` (single values)
4. **Cloudflare adapter pauses after each item instead of each chunk** — more granular checkpointing, same mechanism (queue PAUSE signal + set alarm)
5. **Remove `concurrency` config field entirely** — no backwards compat needed per the plan

Files touched span core (constants, events, blocks, state machine, runner, event-stream, builder, exports) and cloudflare (brain-runner-do adapter).

## Learnings

- The rename was extremely mechanical — the codebase is well-structured and the batch/chunk terminology was consistent, making find-and-replace straightforward
- The semaphore was truly redundant given the governor rate limiting — removing it simplified the code significantly (from ~60 lines of chunked Promise.all to a simple for loop)
- The per-item event granularity is strictly better for resume: each item is now a checkpoint, whereas before you could only resume at chunk boundaries
- The PAUSE signal test needed adjustment because signal check frequency changed — with chunks of size 2 there were 4 control signal checks, but with per-item processing there's one check per item (5 checks for 4 items: 2 in main loop + 3 before items 1-3, with PAUSE at check 5 before item 3)

### Phase 2: Brain-Each Implementation

Phase 2 adds iterate support for `.brain()` steps — both nested brains (BrainBlock) and agent configs (AgentBlock).

**Key decisions:**

1. **No shared `executeIterate` helper** — the per-item processing is fundamentally different across prompt/brain/agent paths. The ~30 lines of shared logic (get items, signal check, yield event) don't justify the indirection of a callback-based helper.

2. **`executeAgent` refactored to not emit `STEP_COMPLETE`** — previously `executeAgent` called `completeStep` in 4 internal locations (terminal tool, no tool calls, max iterations, max tokens). Pulled it out so the caller handles it. This enables iterate-agent to call `executeAgent` per item without getting unwanted STEP_COMPLETE events.

3. **KILL signal must set `this.stopped = true`** — discovered this bug: when iterate methods yield CANCELLED and return, the outer `next()` loop doesn't know execution was killed. Without `this.stopped = true`, it continues and emits COMPLETE after CANCELLED. Same bug existed in `executeIteratePrompt` (just wasn't tested). Fixed in all three iterate methods.

4. **Error handler + state machine depth mismatch** — when an inner brain throws and the error handler catches it, we suppress the inner ERROR event to avoid confusing the state machine. But the inner brain's START event was already forwarded (incrementing depth), and without a COMPLETE event the depth never decrements. Tests for error handling verify via ITERATE_ITEM_COMPLETE events directly instead of relying on state machine reconstruction.

5. **TypeScript `unique symbol` brand default issue** — `TOutputKey extends string & { readonly brand?: unique symbol } = string & { readonly brand?: unique symbol }` fails because each `unique symbol` in a type constraint creates a distinct type. Removed the brand from overload 8 since `TOutputKey` is always inferred from usage.

## Learnings

- The rename was extremely mechanical — the codebase is well-structured and the batch/chunk terminology was consistent, making find-and-replace straightforward
- The semaphore was truly redundant given the governor rate limiting — removing it simplified the code significantly (from ~60 lines of chunked Promise.all to a simple for loop)
- The per-item event granularity is strictly better for resume: each item is now a checkpoint, whereas before you could only resume at chunk boundaries
- The PAUSE signal test needed adjustment because signal check frequency changed — with chunks of size 2 there were 4 control signal checks, but with per-item processing there's one check per item (5 checks for 4 items: 2 in main loop + 3 before items 1-3, with PAUSE at check 5 before item 3)
- **State reconstruction in tests should use the brain state machine**, not manual patch application. The state machine handles depth tracking, patch accumulation, and iterate result collection — reimplementing that logic in tests is error-prone and duplicative.
- Generator-based event streams (using `yield*` delegation) make it easy to compose iterate logic — the inner brain's event stream flows through naturally, and we only need to intercept specific events (ERROR for error handler, STEP_COMPLETE for patches, WEBHOOK to reject).

## Dead ends

- **Manual patch application in tests** — initially tried to reconstruct state by collecting all STEP_COMPLETE patches and applying them. Inner brain patches are relative to inner state, not outer state, causing OPERATION_PATH_UNRESOLVABLE errors. The state machine handles this correctly by tracking depth.
