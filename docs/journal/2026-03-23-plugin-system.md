# Plugin System

**Status:** active
**Started:** 2026-03-23

## Goal

Replace the services/providers pattern with a unified plugin system. The core insight: files, pages, and store are **platform features** (tightly coupled to backend, API routes, CLI) while memory, Slack, Gmail, etc. are **user-configured integrations**. The old design treated them all the same via `ServiceProviders` + `withServices()`, which was wrong — you can't actually swap files/pages/store between backends because they have API+CLI surface area.

Plugins model the integration side cleanly: `definePlugin()` → `brain.withPlugin()` → scoped instance per brain run.

## Log

### Full implementation in one session

Implemented all 5 phases from the plan:

1. **Plugin type system** — `definePlugin()`, `ConfiguredPlugin`, `CreateContext`. Two overloads: with `setup()` for configurable plugins, without for simple ones. `setup()` returns a new `ConfiguredPlugin` with config baked in — free type safety.

2. **Brain DSL integration** — `withPlugin()` intersects `{ [TName]: PluginInjection<TCreate> }` onto `TPlugins` (renamed from `TServices`). `withPlugins()` uses overloads for up to 3 plugins for type inference. `pluginConfigs` stored on Brain, forwarded to inner brains.

3. **Runtime wiring** — `brain.run()` resolves plugins by calling `create()` per plugin, extracts `adapter` (framework-internal), puts remaining properties on context under plugin name. Plugin adapters dispatch happens in `BrainEventStream.next()` via a wrapper around the existing generator. Platform services (files, pages, storeProvider) moved to direct params on `BaseRunParams`.

4. **mem0 as reference plugin** — `definePlugin({ name: 'mem0', setup, create })` bundles provider, tools, and adapter. Scoping logic lives inside `create()`. Tools close over the scoped memory instance. Standalone tools.ts and adapter.ts deleted — no backward compat.

5. **Legacy removal** — Deleted: `withServices()`, `withMemory()`, `ServiceProviders`, `ProviderContext`, `FilesProvider`, `PagesProvider`, `StoreProviderFactory`, `ToolContext`, `providers.ts`, `createMemory` export. Renamed `TServices` → `TPlugins` in all block types, continuation, event-stream. Updated Cloudflare DO to pass platform services directly.

### Key design decision: two dispatch paths for adapters

Plugin adapters are dispatched inside `BrainEventStream` (before yielding events to the runner). Platform adapters (SQLite, Monitor, webhooks) are dispatched by `BrainRunner` (after receiving events). Two separate loops. Since adapters are side-effect-only, ordering between paths doesn't matter. This keeps plugin lifecycle self-contained — the runner never knows about plugin adapters.

### Key design decision: `buildStepContext` returns `any`

The `& TPlugins` intersection on block action types can't be satisfied statically by a dynamic `...this.pluginInjections` spread. Same problem existed before with `...this.services`. Explicit `any` return type on `buildStepContext()` is the pragmatic fix — TypeScript verifies the types at the Brain DSL level (where `withPlugin` intersects the type), not at the runtime assembly level.

## Learnings

- The `withPlugins()` variadic type inference problem is real — can't map a tuple of `ConfiguredPlugin<T1, C1, R1>` to their combined intersection without recursive conditional types. Overloads for 1-3 plugins cover the common cases cleanly.

- Plugin adapter `resume(events)` for replaying historical events wasn't wired up yet. The event stream doesn't receive historical events — those live in the runner's state machine. Will need a separate mechanism when a plugin actually needs resume state reconstruction.

- `StoreProvider` already had the right shape (`(config: { schema, brainTitle, currentUser }) => Store<any>`) so switching from `providers.store` to `storeProvider` direct param was seamless. The store is a platform feature but has a factory pattern because each brain declares its own schema via `withStore()`.

- Forwarding `pluginConfigs` (not resolved instances) to inner brains means each nested brain gets fresh plugin instances scoped to its own title/context. This is correct — an inner brain should have its own mem0 scope, not share the parent's.

### Post-review: withPlugins → brain({ plugins })

Code review caught that `withPlugins` was 50 lines of overloads for little value. Explored alternatives:

- Rest params / array: TypeScript can't extract per-element type params from homogeneous collection types
- Recursive conditional types on tuples: fragile, hard to debug
- Object literal: **winner** — `brain({ plugins: { slack, gmail } })` gives TypeScript per-property inference for free

Added `PluginsFrom<T>` mapped type: `{ [K in keyof T]: T[K] extends ConfiguredPlugin<any, any, infer C> ? PluginInjection<C> : never }`. The injection name comes from the object key, so users can alias (`{ memory: mem0 }` → `ctx.memory`).

Final API: `brain({ plugins: { ... } })` for multiple upfront, `.withPlugin(x)` for add/replace mid-chain. `withPlugins` deleted.

## Dead ends

None — the design was well-established from the prior services redesign session. The implementation was mechanical.

## Solution

`definePlugin()` creates typed plugin definitions. `brain.withPlugin()` registers plugins. `brain.run()` calls `create()` per plugin, splits out `adapter` and `tools`, injects the rest onto `StepContext` under the plugin name. Plugin adapters receive events inside the event stream. Platform services (files, pages, store) bypass plugins entirely — they're passed as direct params from the backend.
