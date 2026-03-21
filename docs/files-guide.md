# Files Service Guide

The files service lets brain steps create, read, and manage files. It handles streaming large files (MP3s, zips) without hitting memory limits.

## Basic Operations

```typescript
.step("Save report", async ({ files }) => {
  // Write content
  const file = files.open('report.txt');
  await file.write('Report content here');

  // Read it back
  const content = await file.read();
  const bytes = await file.readBytes();

  // Check existence
  const exists = await file.exists();

  // Delete
  await file.delete();

  // Get download URL (computed from current origin, never stale)
  const url = file.url;

  // Store just the name in state — lightweight, portable
  return { reportFile: file.name };
})
```

### Convenience Methods

```typescript
// Write without creating a handle
await files.write('quick.txt', 'content');

// List files
const allFiles = await files.list();

// Delete by name
await files.delete('old-file.txt');
```

## Streaming Writes

`file.write()` accepts multiple input types. Responses and streams are never fully buffered.

```typescript
// String or bytes — written directly
await file.write('text content');
await file.write(new Uint8Array([1, 2, 3]));

// Fetch response — streams the body, never buffered
await file.write(await fetch('https://example.com/large-file.mp3'));

// Another file handle — streams from storage to storage
await file.write(files.open('source.txt'));

// ReadableStream
await file.write(someStream);
```

## Scoping

All files are per-user. Three scopes control persistence:

```typescript
// Default: 'brain' — persists across runs, scoped to this brain + user
files.open('data.txt');

// 'run' — ephemeral, cleaned up after this brain run
files.open('temp.txt', { scope: 'run' });

// 'global' — persists across runs AND across brains, per user
files.open('profile.json', { scope: 'global' });
```

## Zip Builder

Streaming zip creation. Content flows through fflate into R2 via multipart upload — peak memory is ~5MB, never the whole zip.

```typescript
.step("Bundle results", async ({ state, files }) => {
  const zip = files.zip('results.zip');

  // Inline content
  await zip.write('manifest.txt', state.items.join('\n'));

  // Stream from storage (R2 → fflate → R2)
  await zip.write('transcript.txt', files.open('transcript.txt'));

  // Stream from URL (fetch → fflate → R2)
  await zip.write('episode.mp3', await fetch(state.mp3Url));

  const ref = await zip.finalize();
  return { downloadUrl: files.open(ref.name).url };
})
```

## JSX Template Components

Import `File` and `Resource` from `@positronic/core` to inject file/resource content into prompts:

```tsx
import { File, Resource } from '@positronic/core';

.prompt("Analyze", ({ state }) => ({
  prompt: (
    <>
      Reference guidelines:
      <Resource name="guidelines" />

      Transcript to analyze:
      <File name={state.transcriptFile} />
    </>
  ),
  outputSchema: z.object({ summary: z.string() }),
}))
```

The renderer resolves these during template evaluation. File content is buffered (LLM APIs require full text).

## Prompt Attachments

For PDFs, images, and other binary files, use attachments instead of injecting content as text:

```typescript
.prompt("Analyze", async ({ state, files }) => ({
  prompt: "Analyze the attached document.",
  attachments: [files.open(state.pdfFile)],
  outputSchema: z.object({ summary: z.string() }),
}))
```

The framework resolves `FileHandle` objects to binary data + MIME type before passing to the LLM client.

## Agent Tools

`readFile` and `writeFile` let agents read and write files on demand:

```typescript
import { readFile, writeFile } from '@positronic/core';

.brain("Analyze files", () => ({
  prompt: "Review the transcripts and write a summary.",
  tools: { readFile, writeFile },
}))
```

The agent decides which files to read and what to write. Tools access `context.files` internally.

## Usage Patterns

### Don't keep large data in state

Write to files early, pass names through state:

```typescript
// Save transcripts to files immediately
.step("Save transcripts", async ({ state, files }) => {
  const names = [];
  for (const [i, transcript] of state.transcripts.entries()) {
    await files.write(`transcript-${i}.txt`, transcript);
    names.push(`transcript-${i}.txt`);
  }
  return { transcriptFiles: names, mp3Urls: state.mp3Urls };
})
// Later, bundle them without loading into memory
.step("Package", async ({ state, files }) => {
  const zip = files.zip('bundle.zip');
  for (const name of state.transcriptFiles) {
    await zip.write(name, files.open(name)); // streams from R2
  }
  const ref = await zip.finalize();
  return { downloadUrl: files.open(ref.name).url };
})
```

### File events

File write operations emit `FILE_WRITE_START` and `FILE_WRITE_COMPLETE` events during step execution. These appear in the CLI event view between `STEP_START` and `STEP_COMPLETE`.
