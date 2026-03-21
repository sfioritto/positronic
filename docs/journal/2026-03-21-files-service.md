# Files Service — Framework-Level File Storage

**Status:** shipped
**Started:** 2026-03-21
**Shipped:** 2026-03-21
**Commit:** 659396f

## Goal

Add a `files` service to the brain step context that lets brain authors create, read, and manage files (especially large ones like MP3s and zips) without running into Cloudflare Worker memory limits. The motivating use case: a brain that finds podcast transcripts and MP3s, bundles them into a zip, and gives the user a download link. Currently requires a custom S3 storage service outside the framework and manually managing memory with fflate.

The design principle: streaming by default. File objects are lazy handles — consumers that can stream (zip builder, file-to-file copy) stream automatically. Consumers that must buffer (LLM prompts) buffer. Brain authors pass File objects around and the framework does the right thing.

## Design Decisions

### `write()` as the single verb

We debated `download`, `fetch`, `ingest`, `pull` as methods for "get content from a URL into storage." Landed on a single `write()` method that's polymorphic over input types: strings, bytes, `Response`, `ReadableStream`, or `File` handles. The backend figures out the optimal path. `await file.write(await fetch(url))` is the pattern for URL-sourced content — `fetch` is just `fetch`, `write` is just `write`, they compose naturally. This killed the naming debate entirely.

### File handles, not URLs in state

`files.open(name)` returns a lazy handle with a computed `url` property (from current origin). State stores only the file name string. URLs are never serialized into state, so they're never stale across environments. This follows the pages pattern (origin from R2 `__config/origin`).

### Scoping: always per-user

Three scopes: `'run'` (ephemeral), `'brain'` (default, persists across runs), `'global'` (cross-brain). All are always per-user — no file is ever visible to other users. This mirrors store's per-user scoping.

### Zip builder streams through R2 multipart upload

fflate's `Zip` class is callback-based (already streaming). Instead of collecting chunks in memory, each chunk goes to an R2 multipart upload buffer (~5MB parts). Peak memory: one part buffer + one in-flight chunk. Auto-abort on error.

### `<File>` and `<Resource>` JSX components

Resolved during `resolveTemplate()`. Framework reads file/resource content and injects as text. Must buffer for LLM API — but the brain author doesn't think about it. Declarative and clean.

### Attachments on prompts

Separate from JSX injection. `attachments` field on `.prompt()` config sends files as proper API attachments (images, PDFs, audio). Each client (Anthropic, Vercel) maps to its format. File handles stream their content to the client.

### Agent tools: `files.readTool` / `files.writeTool`

Pre-built tool definitions. Agent reads/writes on demand — only loads what it needs. Scoped to same brain+user context.

## Phases

1. Foundation — core types + Cloudflare R2 implementation + runner wiring
2. Zip builder — fflate + R2 multipart upload, streaming
3. Spec + testing — spec contracts, mock implementation, tests
4. Events — FILE_DOWNLOAD_START/PROGRESS/COMPLETE, CLI display
5. JSX components — `<File>` and `<Resource>` in templates
6. Attachments — client interface, Anthropic + Vercel implementations
7. Agent tools — readTool, writeTool
8. Documentation

## Log

### Phase 1 Implementation (2026-03-21)

Phase 1 done — `files` is on the step context and working end-to-end. Core types defined, wired through BrainEventStream/BrainRunner, Cloudflare R2 implementation working, API route serving files publicly, all tests passing (11 core + 17 cloudflare).

Key implementation detail: `prepareRunner()` in `brain-runner-do.ts` needed `currentUser` as a new parameter since the files service requires user scoping at creation time — previously it only received `brainTitle` and `brainRunId`, with `currentUser` passed later to `runner.run()`.

Named the interface `FileHandle` (not `File`) to avoid collision with the global `File` constructor in browser/worker environments. `FileInput` union type accepts `FileHandle` as one of its variants for the copy-between-files use case.

### Phase 2 Implementation (2026-03-21)

Zip builder done. `files.zip()` returns a `ZipBuilder` that streams zip content through fflate into R2 via multipart upload. fflate's `Zip` callback is synchronous (fires during `push()` calls), so we buffer output synchronously and flush to R2 asynchronously when the buffer hits 5MB. `ZipPassThrough` is used (store mode, no compression) since the target content (MP3s, images, PDFs) is already compressed.

Key design: lazy initialization. `files.zip()` returns synchronously — the R2 multipart upload isn't created until the first `write()` call. This avoids the awkward `await files.zip(...)` pattern.

Auto-abort on error: if any `write()` or `finalize()` throws, the multipart upload is aborted immediately. If the step errors after `write()` but before `finalize()`, R2 cleans up incomplete uploads automatically (7-day TTL).

### Phase 4 Implementation (2026-03-21)

File events via event channel. The core challenge: the event stream can only `yield` while it controls execution, but file operations happen inside user step code. Solved with `Promise.race` — the event stream races between the step promise completing and file events arriving on an `EventChannel` queue. The files service is wrapped transparently by the framework to push events on every write operation.

Key architectural insight: this pattern is generic. The `EventChannel` + race loop can be used by any service that needs to emit events during step execution, not just files. The wrapper (`event-wrapper.ts`) is in core, not in the backend — so event emission is free for all backends.

The wrapper uses an `EventSink` interface (just `{ push(event): void }`) rather than depending on the full `EventChannel` type, keeping the coupling minimal.

### Phase 5 Implementation (2026-03-21)

`<File>` and `<Resource>` as built-in template components. First attempt put them on StepContext as function components — wrong place, they're template concepts not services. Redid as Symbols in `jsx-runtime.ts` (like `Fragment`), recognized by the renderer. Brain authors import them statically from `@positronic/core`.

Key design: `TemplateContext` uses simple `readFile`/`readResource` functions, not full service objects. `buildTemplateContext(files, resources)` factory localizes the `as any` cast for resources' Proxy-based `loadText`. `resolveTemplate` context defaults to `{}` so existing call sites don't change.

### Phase 6 Implementation (2026-03-21)

Prompt attachments. `Attachment` type on `generateObject` params, resolved from `FileHandle[]` in `.prompt()` config. Vercel client maps to `FilePart` content blocks. Anthropic client skipped — being deprecated. MIME type inference via hand-rolled map in core (conscious decision to avoid dependency).

### Phase 7 Implementation (2026-03-21)

`readFile` and `writeFile` as standalone agent tools exported from `@positronic/core`. Initially designed as `files.readTool`/`files.writeTool` properties on `FilesService`, but standalone tools are cleaner — no interface change, no pre-binding, same pattern as `print`/`consoleLog`/`generatePage`. They access `context.files` in their `execute` function.

## Learnings

- Cloudflare R2 doesn't have native CopyObject like S3 — file copy still streams bytes through the Worker, but as a pipe, not buffered
- `fetch()` Response is inherently streaming — body is a `ReadableStream`, bytes haven't arrived when the Promise resolves. So `file.write(await fetch(url))` streams automatically without any special handling
- R2 multipart upload requires ~5MB minimum part size (except last part) — this sets the buffer size for streaming zip creation
- The real memory problem in the original brain wasn't the zip encoding — it was `chunks.push(data)` collecting the entire zip output before upload. fflate was already streaming; the output path wasn't
- Cloudflare vitest-pool-workers isolated storage fails when `R2ObjectBody` streams aren't consumed — use `bucket.head()` instead of `bucket.get()` when you only need metadata
- The `files` service follows the `pages` injection pattern (always available, direct instance) rather than the `store` pattern (factory function, conditional creation from schema). No `.withFiles()` DSL method needed.
- Mid-step event emission from user code requires `Promise.race` between the step promise and an event channel — the event stream can't yield while awaiting a step. The wrapper pattern (intercept service calls, push to channel) keeps this transparent to brain authors.
- JSX template components should be Symbols recognized by the renderer, not properties on StepContext. `TemplateContext` with simple functions (`readFile`, `readResource`) keeps the renderer free of service types.
- Agent tools are better as standalone exports than as service properties — no pre-binding, same import pattern as other built-in tools.

## Solution

8-phase implementation of a framework-level files service:

1. **Foundation** — `FilesService`/`FileHandle`/`FileRef` interfaces in core, R2 implementation in cloudflare, wired into step context via BrainRunner
2. **Zip builder** — fflate `ZipPassThrough` + R2 multipart upload, lazy init, auto-abort on error
3. **Spec/testing** — already covered by core + cloudflare integration tests
4. **Events** — `EventChannel` + `Promise.race` for mid-step FILE_WRITE_START/COMPLETE emission, transparent wrapper
5. **JSX components** — `File`/`Resource` as Symbols in jsx-runtime, resolved by renderer via `TemplateContext`
6. **Attachments** — `Attachment` type on `generateObject`, FileHandle resolution in `.prompt()`, Vercel FilePart mapping
7. **Agent tools** — `readFile`/`writeFile` standalone tools accessing `context.files`
8. **Documentation** — CLAUDE.md, standalone guide, template brain-dsl-guide
