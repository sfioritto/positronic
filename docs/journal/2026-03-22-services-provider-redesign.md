# Services Provider Redesign → Plugin System

**Status:** active
**Started:** 2026-03-22

## Goal

Started as cleaning up inconsistent service injection. Evolved into a broader redesign after realizing that files/pages/store are platform features (not swappable services) and that user-configured integrations (memory, slack, etc.) are better modeled as plugins.

## Log

### Taxonomy discovery

Cataloged every injectable thing across `BrainRunner`, `Brain`, `BaseRunParams`, and `StepContext`. Surfaced the real categories: per-run params, runner plumbing, client, core services, user-defined passthrough.

### Provider pattern (implemented, being superseded)

Built a provider pattern: runner holds factory functions, `brain.run()` calls them with `ProviderContext`. Cleaned up `BrainRunner` (removed all `with*` methods), simplified memory to raw `MemoryProvider`, removed `ScopedMemory`/`MemoryProviderFactory`, renamed things. All tests pass.

### The "swappable services" illusion

Explored making all services (files, pages, store, memory) follow the same provider pattern so they could be swapped. Then discovered that files/pages/store have **dual implementations** in Cloudflare — the service interface for brain execution AND separate direct-R2 implementations for API routes + CLI. The API routes completely bypass the service interfaces.

This means you can't actually swap these services — they're deeply integrated platform features with API surface area the CLI depends on. Only memory is truly swappable (it's a simple search/add interface with no CLI/API dependencies).

### Plugin system design

Instead of the provider pattern, landed on:

1. **Platform services** (files, pages, store) — backend-internal, always on `StepContext`, no user configuration, no providers
2. **Plugins** — user-configured bundles that replace both `services` and `providers`

A plugin bundles: `inject` (what goes on StepContext), `tools` (optional), `adapter` (optional), `setup` (typed config). The `definePlugin()` API lets plugin authors define the shape. Brain authors use `.withPlugin()` / `.withPlugins()` and `createBrain({ plugins })`.

The key DX: `slack.setup({ token: '...' })` returns a configured plugin instance. TypeScript checks the config against the setup parameter type. No generics gymnastics.

## Learnings

- Scoping logic (binding brainTitle + userId) belongs in the framework, not userland
- `withServices` replacing vs merging was a subtle footgun — changed to merge
- Files/pages/store can't actually be swapped between backends because they have API+CLI surface area. The spec package defines the contract, each backend implements the whole thing.
- The "provider" abstraction was an unnecessary indirection for platform features. The real need was: some things are platform, some things are user-configured integrations. Plugins model the integration side cleanly.
- Having a `.setup()` method on the plugin gives free type safety for config without generics

## Dead ends

### Provider pattern for files/pages/store

Built a full provider system (`ServiceProviders`, `ProviderContext`, factory functions). Works for brain execution but falls apart when you consider: API routes bypass the service, cleanup adapters need direct backend access, CLI needs to list/delete these resources. They're platform features, not pluggable services.

### MemoryProviderFactory

Factory wrapper around raw MemoryProvider. Just boilerplate. Simplified to passing the raw provider and letting the framework scope it.

### ScopedMemory deprecated alias

Dead weight in a breaking redesign. Deleted.
