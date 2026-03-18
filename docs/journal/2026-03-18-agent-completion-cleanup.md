# Agent completion path cleanup

**Status:** shipped
**Started:** 2026-03-18
**Shipped:** 2026-03-18

## Goal

Now that `outputSchema` is required on all agent steps, several old code paths became dead weight. The goal was to remove them so the codebase reflects the actual invariant: agents always finish by calling the auto-generated `done` tool.

## Log

### Identifying the dead code

Three things fell out of making `outputSchema` required:

1. **`defaultDoneSchema`** — a fallback schema for when outputSchema was optional. Exported from core but unused anywhere. Straightforward delete.

2. **`toolChoice` defaulting in each client** — both Anthropic and Vercel clients had `toolChoice = 'required'` as a destructuring default. This is fragile: if someone writes a third client and forgets, agents silently misbehave. Moved the default into `event-stream.ts` (the framework layer) so clients don't need to know about it. Clients still defensively default at their own call sites (`?? 'required'`) since `toolChoice` is optional in the interface — but they're no longer the source of truth.

3. **Silent return on no tool calls** — with `toolChoice: 'required'`, the LLM should never return zero tool calls. The old code silently returned, which would let the agent exit without producing its required output. Replaced with a throw that explains what happened.

4. **`if (config.outputSchema)` guards** — maxIterations and maxTokens handlers had conditional throws guarded by `if (config.outputSchema)`, with a `return` fallback for the no-schema case. Since outputSchema is always present, collapsed to unconditional throws and deleted the dead `return` branches.

### Type error in Anthropic client

After removing the `= 'required'` default from the Anthropic client's destructuring, `toolChoice` became `ToolChoice | undefined`. The `toAnthropicToolChoice()` helper expected `ToolChoice` (non-optional), so TypeScript flagged the two call sites. Fixed by adding `?? 'required'` at the call sites. The Vercel client didn't have this issue because the Vercel SDK accepts `undefined` natively.

### Test needed a try-catch

The "no tool calls" test originally expected silent completion. Updated it to expect an error. First attempt failed because the error propagated as an uncaught exception from the async generator. Turns out `event-stream.ts` catches errors, yields an ERROR event, then **re-throws** (line 449). So the `for await` loop sees the ERROR event, but the next iteration throws. The existing maxTokens test already handles this with a try-catch — matched that pattern.

## Learnings

- **Generator error semantics**: When an async generator's catch block yields events then re-throws, consumers see the yielded events first, then the throw on the next `.next()` call. Any test that expects error events from the brain must wrap the `for await` in try-catch.

## Solution

Five targeted changes across core, both clients, and the test file. The framework (`event-stream.ts`) is now the single source of truth for `toolChoice` defaulting, dead schema exports are gone, and impossible code paths throw instead of silently returning.
