# Replace iteration overloads with `.map()` method

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

Iteration was bolted onto `.prompt()` and `.brain()` via `iterateConfig` parameters, creating 4 extra overloads (1 on prompt, 3 on brain) and 3 separate execution paths (~400 lines). The goal was to replace all of this with a single `.map()` method that runs a brain per item. If you need prompt-per-item or agent-per-item, you wrap it in a small brain. This is a breaking change.

The motivation: the iterate API was scattered across multiple methods and overloads, making it hard to maintain and reason about. Every time we changed something about iteration (like the `over` context, or error handling), we had to touch all 3 execution paths and all 4 overloads. A single `.map()` method with one execution path is dramatically simpler.

## Log

### The refactor

Removed `iterateConfig` from `StepBlock`, `BrainBlock`, and `AgentBlock`. Added a new `MapBlock` type to the block union. Deleted 4 overloads (3 from `.brain()`, 1 from `.prompt()`), deleted 3 `executeIterate*` methods (~370 lines), added 1 `executeMap()` method. Net deletion: ~360 lines.

The key design decision: `.map()` always takes an inner brain. No more "iterate a prompt" or "iterate an agent" — those become a brain wrapping a prompt or agent. This eliminates the need for separate execution paths entirely.

### Inner brain COMPLETE events — the one test surprise

After the refactor, a Cloudflare test (`Iterate + Webhook Resumption`) failed because it asserted that no `brain:complete` event existed before the webhook paused the brain. But now with `.map()`, the inner brain emits its own `brain:complete` as each item finishes. The fix was to filter for the _outer_ brain's complete event by title, not any complete event. This is actually a more correct assertion — it's testing what it should have been testing all along.

## Learnings

- **Wrapping in a brain changes event topology**: When you move from "iterate a prompt" to "iterate a brain that contains a prompt", the inner brain now emits START/COMPLETE events that didn't exist before. Any test asserting on "no COMPLETE event" needs to scope to the right brain title.

- **The state machine and event replay code didn't need any changes**: `iterateContext`, `iterateItemComplete` reducer, `iterateProgress` in `ResumeContext` — all stayed as-is because they're event-driven and decoupled from block types. The `.map()` method emits the same events as the old iterate paths. This is good architecture validation.

- **TypeScript overload elimination pays off immediately**: Going from 8 `.brain()` overloads to 5, and 3 `.prompt()` overloads to 2, makes the type signatures dramatically easier to read. The `.map()` method has zero overloads — just one signature.

## Dead ends

None — this was a well-planned mechanical refactor. The plan was detailed enough that execution was straightforward.

## Solution

Single `.map()` method on Brain builder, single `MapBlock` type, single `executeMap()` in the event stream. The API:

```typescript
.map('Process Items', {
  over: ({ state }) => state.emails,
  run: innerBrain,
  initialState: (item) => ({ value: item.body }),
  outputKey: 'results' as const,
  error?: (item, error) => fallbackOrNull, // Optional — default: log + skip
})
```

All existing iterate behavior (resume support, signal checking, error handling, IterateResult accumulation) is preserved in the single execution path. The Cloudflare adapter's `IterateItemAdapter` works unchanged because it's event-driven.
