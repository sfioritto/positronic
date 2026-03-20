# Remove stateKey from prompt/ui/agent/brain steps

**Status:** shipped
**Started:** 2026-03-19
**Shipped:** 2026-03-19

## Goal

Remove `stateKey` from `.prompt()`, `.ui()`, `.agent()`, and `.brain()` (nested) steps. Instead of storing results under `state[stateKey]`, spread them directly onto state. Users who want namespacing put the namespace in their `outputSchema` or inner brain state shape.

The motivation: stateKey was solving a real problem (don't pollute state with raw schema keys) but at the wrong layer. The schema already defines the shape of the output — making users specify _both_ a schema and a separate key name for where it goes was redundant. The `as const` ceremony and branded string type gymnastics were friction for no real benefit when the schema itself can carry the namespace.

## Log

### The key insight

The conversation started from noticing that block type definitions were using `any` for types that only matter at the builder level. That led to questioning whether `stateKey` was a good idea at all. The realization: if you want `state.userInfo = { name, age }`, just make your outputSchema `z.object({ userInfo: z.object({ name: z.string(), age: z.number() }) })`. LLMs handle nested schemas perfectly well — it's just JSON Schema under the hood.

### The map exception

`.map()` produces an `IterateResult` (array-like wrapper) that can't be spread onto state — it fundamentally needs a key name. We considered renaming it to `resultsKey` but decided against it: once stateKey is removed from everywhere else, it's only used by `.map()`, and the name still makes perfect sense. No rename needed.

### Nested brain spreading

For `.brain()` (nested), spreading the inner brain's final state onto the outer state works the same way as spreading outputSchema results. If the inner brain returns `{ value: 10, inner: true }` and the outer brain had `{ prefix: 'test-' }`, the merged state is `{ prefix: 'test-', value: 10, inner: true }`. If users want namespacing, they design the inner brain to return `{ analysis: { ... } }`.

### Typecheck caught what runtime missed

Tests pass with SWC/Jest even with stale `stateKey` in object literals — runtime doesn't enforce TypeScript's excess property checks. Running `npm run typecheck` caught ~15 additional stateKey references in nested brain configs that the test-fixing agents missed because the tests still passed at runtime. Lesson: always run typecheck after type-level refactors, don't rely on test pass/fail alone.

Also caught two pre-existing issues in the UI step tests: a `jest.fn()` needing an explicit `<any>` generic, and a resume test missing `brainRunId` at the top level of `ResumeRunParams`. These were masked by the old overload resolution.

## Learnings

- **Type erasure is intentional in blocks.ts** — the builder overloads enforce types at compile time, blocks are runtime containers. This made the stateKey removal clean: only had to change overload signatures and runtime spread logic.

- **The branded string pattern** (`{ readonly brand?: unique symbol }` + `string extends T ? never : unknown`) was _only_ needed for stateKey literal inference. Deleted it from all overloads except `.map()`. Big DX win — no more `as const` for prompt/ui/agent/brain.

- **`AgentConfigWithOutput` went from 3 generics to 2** — removing `TName` simplified every agent overload in brain.ts, create-brain.ts, and the `brain()` factory function.

- **Spreading shared type extraction wasn't worth it** — we explored extracting a shared `PromptConfig<TState, TOptions, TServices, TSchema>` type for the `template + outputSchema` pair used across `.prompt()`, `.ui()`, and `.map()`. Each method's `template` callback has a different context type (map adds `item`), so sharing saves only one duplicated line per overload. Not worth the indirection.

## Dead ends

None — the design was clear from the discussion phase. The only question was what to do about `.map()`, and keeping `stateKey` there was the obvious answer once we identified that arrays can't be spread onto objects.

## Solution

- **Types**: Removed `stateKey` from `AgentConfig`, `AgentConfigWithOutput` (now 2 generics), `BrainBlock`, `StepBlock.uiConfig`. Kept in `MapBlock` and `IterateItemCompleteEvent`.
- **Builder**: Rewrote overloads for `.prompt()`, `.ui()`, `.brain()` (nested + agent). `TNewState` defaults changed from `TState & { [K in TKey]: ... }` to `TState & z.infer<TSchema>` (or `TState & TInnerState` for nested brain).
- **Runtime**: Changed `{ ...state, [stateKey]: result }` to `{ ...state, ...result }` in event-stream.ts for nested brain execution, agent done tool, and UI resume path.
- **Tests**: Updated ~80 test assertions across brain.test.ts, agent.test.ts, signals.test.ts, current-user.test.ts, jsx-template.test.ts, type-inference-debug.ts.
- **Docs**: Updated brain-dsl-guide.md, tips-for-agents.md, ui-step-guide.md, agent-steps-guide.md, and template brains.
