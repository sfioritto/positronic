# Add prompt mode to .map()

**Status:** shipped
**Started:** 2026-03-18

## Goal

When the iterate overloads were replaced with `.map()`, the prompt-per-item pattern was lost. Users had to wrap a prompt in a tiny inner brain to iterate prompts. The goal is to add a prompt-mode overload to `.map()` so you can iterate a prompt directly without the brain wrapper.

The user's `search-and-validate` brain was still calling the old `.prompt(title, config, { over, error })` 3-argument API, which silently ignored the third argument after the refactor — the iterate overload was removed but the call compiled (extra args are ignored at runtime). This surfaced the need for prompt support in `.map()`.

## Log

### Type inference struggles with nested config

First attempt used a nested `prompt: { template, outputSchema, client? }` sub-object in the `.map()` config. TypeScript couldn't infer `TSchema` from two levels of nesting (`config.prompt.outputSchema.schema`) and fell through to the brain-mode overload, producing `outputKey: never` errors.

Also discovered a gotcha: the `dist/types/*.d.ts` files were stale. TypeScript was resolving types from the built declarations, not the source. Must rebuild before typechecking when changing overloads.

**Fix:** Flattened the prompt config — `template`, `outputSchema`, and `client?` sit at the top level alongside `over` and `outputKey`. The builder packs them into the `MapBlock.prompt` internal structure. This keeps `outputSchema.schema` at one level of nesting, matching the existing `.prompt()` overload where inference already works.

### NoInfer on the template item type

Used `NoInfer<TItems[number]>` in the template context to prevent TypeScript from trying to co-infer `TItems` from the template's contravariant parameter. `TItems` is inferred solely from `over`'s return type, and the template's `item` type is checked against it after inference. (Turns out the flatten fix was the real solution, but NoInfer stays as a safety measure.)

## Learnings

- **TypeScript generic inference degrades with nesting depth.** Inferring `TSchema` from `config.prompt.outputSchema.schema` (two levels deep) fails, but `config.outputSchema.schema` (one level) works fine. The existing `.prompt()` overload proves the one-level pattern works.
- **Stale `.d.ts` files silently break typecheck.** The root tsconfig resolves to `dist/types/`, not the source. Always `npm run build:workspaces` before `npm run typecheck` when changing type signatures.
- **Extra function arguments are silently ignored in JavaScript.** The old `.prompt(title, config, { over })` compiled and ran without errors after the iterate overload was removed — the third argument was just dropped at runtime. The brain ran a single prompt instead of iterating, producing wrong state.

## Dead ends

- **Nested `prompt:` sub-object in config** — clean API but TypeScript couldn't infer the schema type from two levels of nesting.
- **`NoInfer` alone** — applied to the template's `item` type, but didn't fix the core inference issue (which was nesting depth, not co-inference).

## Solution

Added a second overload to `.map()` with flat prompt config:

```typescript
.map('Validate results', {
  template: ({ item, options }) => `${options.validationPrompt}\n${item.content}`,
  outputSchema: {
    schema: z.object({ matches: z.boolean(), reason: z.string() }),
    name: 'validation',
  },
  over: ({ state }) => state.crawledResults,
  outputKey: 'validations' as const,
  error: () => null, // Optional — default behavior is log + skip
})
```

Execution in `executeMap()` checks `block.prompt` — if present, calls `generateObject` per item instead of running an inner brain. Results are collected as `IterateResult<TItem, z.infer<TSchema>>` tuples, same as brain mode.
