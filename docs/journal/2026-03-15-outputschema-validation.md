# OutputSchema Runtime Validation

**Status:** active
**Started:** 2026-03-15

## Goal

A user-defined brain with `outputSchema` was crashing with `Cannot read properties of undefined (reading 'audioUrl')` because the AI agent sometimes didn't produce valid structured output, but the framework silently assigned whatever it got (including undefined) to state and moved on. The downstream step then blew up on a property access.

We needed the framework to catch this at the source rather than letting it silently corrupt state.

## Log

### Discovery

Traced the code path in `event-stream.ts`. Three places where `outputSchema` output could be missing or invalid:

1. **Terminal tool (`done`) called with invalid args** — The LLM calls `done` but the args don't match the Zod schema. Framework was assigning `toolCall.args` directly without validation.
2. **Iteration limit hit** — Agent runs out of `maxIterations` without ever calling `done`. The `return` on line 940 just exits the generator — no error, no state update. The `outputSchema.name` key never gets set.
3. **Token limit hit** — Same pattern as iteration limit.

The user's specific bug was likely path #2 — the inner brain agent hit maxIterations (set to 5) without calling `done`, and the outer `mapOutput` callback tried to destructure `result` from state where it was never set.

### Fix

Three changes to `event-stream.ts`:

1. **safeParse validation on `done` tool** — When the LLM calls `done` with `outputSchema` configured, validate `toolCall.args` against the schema using `safeParse`. Throw with a descriptive error if validation fails. Also uses `parsed.data` instead of raw `toolCall.args` so Zod defaults/transforms are applied.
2. **Throw on iteration limit** — After yielding `AGENT_ITERATION_LIMIT` event, throw if `outputSchema` is configured (agent was supposed to produce output but didn't).
3. **Throw on token limit** — Same pattern as iteration limit.

These throws get caught by the existing try/catch in `next()` (line 415), which yields an ERROR event and re-throws. So the error flows properly through the event system.

### Why `any` hid this

The user's inner brain was typed as `brain<any, ...>`. With `any` as the state type, TypeScript is happy with any property access — `state.result.audioUrl` compiles fine even when `result` might not exist. Even with proper types, the `outputSchema` mechanism would type the output key as definitely present since the schema "guarantees" it. The real gap is that AI agents aren't bound by TypeScript contracts.

## Learnings

- `yield*` delegation from a sub-generator propagates throws through the entire chain — the try/catch in the outer generator (`next()`) catches errors thrown inside `executeAgent()` even though there are two layers of `yield*` in between.
- The catch handler in `next()` yields ERROR events and then **re-throws** — so tests need a try/catch around the `for await` loop to collect all events before the re-throw kills iteration.
- The iteration/token limit paths (`AGENT_ITERATION_LIMIT`, `AGENT_TOKEN_LIMIT`) were "silent exits" — they yielded an event and returned without any state update. For brains without `outputSchema` this is fine (state just doesn't change). For brains _with_ `outputSchema`, this meant the output key was never set, leading to undefined access crashes downstream.

## Dead ends

None — the fix was straightforward once the code path was traced.
