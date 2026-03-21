# Files Service — Framework-Level File Storage

**Status:** active
**Started:** 2026-03-21

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

## Learnings

- Cloudflare R2 doesn't have native CopyObject like S3 — `writeFrom(file)` (renamed to `copy` conceptually) still streams bytes through the Worker, but as a pipe, not buffered
- `fetch()` Response is inherently streaming — body is a `ReadableStream`, bytes haven't arrived when the Promise resolves. So `file.write(await fetch(url))` streams automatically without any special handling
- R2 multipart upload requires ~5MB minimum part size (except last part) — this sets the buffer size for streaming zip creation
- The real memory problem in the original brain wasn't the zip encoding — it was `chunks.push(data)` collecting the entire zip output before upload. fflate was already streaming; the output path wasn't
