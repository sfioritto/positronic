# Iterate prompt `TItem` inference regression

**Status:** shipped
**Started:** 2026-03-17
**Shipped:** 2026-03-17

## Goal

Fix `TItem` inference in the iterate prompt overload. TypeScript can't infer `TItem` from `over`'s return type — it falls back to `unknown`. This forces users to annotate `item` in the template callback, breaking the DSL's inference-first design.

## Log

### Investigation

The user noticed `(parameter) item: unknown` in the `.prompt()` template callback for an iterate prompt. Screenshots confirmed:

- `brainState` in the `.brain()` callback: correctly typed (inner brain state flows through)
- `state` in the `.guard()` callback: correctly typed (`{ matches: { url, title, content, reason }[] }`)
- `item` in the `.prompt()` template: `unknown`

So the break is specifically in the prompt iterate overload's `TItem` inference, not in nested brain state flow.

### Root cause (first theory — wrong)

Initially blamed commit 703ff37 which changed `over` from `(state: TState) => TItem[]` to the full `StepContext` intersection. Tried splitting sync/async overloads to remove the `| Promise<TItem[]>` union. Typecheck passed but inference was still broken in real-world usage.

### Root cause (actual)

Created standalone reproductions that progressively stripped away complexity. Even the simplest possible form failed:

```typescript
class Test<TState> {
  prompt<TItem>(
    template: (item: TItem) => string,
    over: (state: TState) => TItem[]
  ): void {}
}
```

The real issue: **TypeScript evaluates function arguments left-to-right.** When `TItem` appears as a callback parameter in an earlier argument (`template`) and as a callback return type in a later argument (`over`), TypeScript locks `TItem = unknown` while processing the first argument and never backtracks after processing the second.

This was never a regression from any specific commit — it's a fundamental TypeScript inference limitation. It was always broken, but was masked because users were explicitly annotating `item` types.

### Fix: `TItems extends any[]` with `TItems[number]`

Replace `TItem` with `TItems extends any[]`. TypeScript infers the full array type from `over`'s return type, then `TItems[number]` extracts the element type via indexed access. This works because:

1. `TItems` only appears in `over`'s return position — a single covariant inference site
2. `TItems[number]` in `template`'s parameter is a **type-level computation**, not an inference site
3. TypeScript doesn't need to infer anything from `template` — it just evaluates `TItems[number]` after inferring `TItems` from `over`

Applied to all iterate overloads: prompt (overload 2), nested brain (6), agent with schema (7), agent without schema (8). Also collapsed the sync/async split (6b, 7b, 8b) back into single overloads with `TItems | Promise<TItems>` since the union is fine when TItems is the whole array.

Typecheck passes. All 576 + 183 tests pass.

## Dead ends

### Split sync/async overloads (first attempt)

Split every `over: (...) => TItem[] | Promise<TItem[]>` into separate sync and async overloads. Passed typecheck but didn't fix inference — the sync overload still had the same left-to-right problem.

### `NoInfer<TItem>` (TypeScript 5.4+)

Tried wrapping `template: (item: NoInfer<TItem>) => ...` to prevent TypeScript from inferring TItem from that position. Didn't work because TypeScript's left-to-right processing means it still needs to _type_ the `item` parameter before reaching `over`, even if it doesn't _infer_ from it. When `over` comes in a later argument, `NoInfer` can't help.

Interesting finding: `NoInfer` works perfectly when `over` comes in an **earlier** argument. The issue is purely about argument ordering.

### Reverting to simple `over: (state: TState) => TItem[]`

Reverted the full `StepContext` intersection back to the old simple signature. Still failed — confirming the root cause wasn't the `StepContext` complexity.

## Learnings

- **TypeScript evaluates callback types left-to-right across arguments.** A type parameter can't be inferred from argument N and used in argument N-1's callback parameter. This is fundamental and no amount of type-level tricks (NoInfer, union splitting) can overcome it within the same argument structure.
- **The `TItems extends any[]` + `TItems[number]` pattern is the canonical fix.** Instead of inferring the element type from a callback return and using it in another callback's parameter, infer the full container type and extract the element via indexed access. The indexed access is a computation, not an inference site.
- **`NoInfer<T>` is argument-order-dependent.** It blocks inference from a specific position but doesn't enable backward inference across arguments. It only works when the inference source comes in an earlier argument than the blocked site.
- The sync/async overload split was based on a wrong root cause theory. The union `T[] | Promise<T[]>` was never the problem — the left-to-right evaluation was.

## Solution

Replace `TItem` with `TItems extends any[]` across all iterate overloads. Use `TItems[number]` everywhere the element type is needed (template, error, initialState, configFn, IterateResult). TypeScript infers `TItems` from `over`'s return type and derives element types via indexed access. No API changes — callers don't need to change anything. The `| Promise<TItems>` union on `over` works fine since it's the whole array being inferred, not the element.
