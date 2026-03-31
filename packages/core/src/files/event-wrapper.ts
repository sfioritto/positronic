import type {
  Files,
  FileHandle,
  FileInput,
  FileOptions,
  FileRef,
  ZipBuilder,
} from './types.js';
import type {
  FileWriteStartEvent,
  FileWriteCompleteEvent,
} from '../dsl/definitions/events.js';
import type { JsonObject } from '../dsl/types.js';
import { BRAIN_EVENTS } from '../dsl/constants.js';

type FileEvent = FileWriteStartEvent | FileWriteCompleteEvent;

/** Minimal interface — the wrapper only needs push(), not the full EventChannel */
interface EventSink {
  push(event: FileEvent): void;
}

interface EventContext {
  options: JsonObject;
  brainRunId: string;
  stepTitle: string;
}

function startEvent(ctx: EventContext, fileName: string): FileWriteStartEvent {
  return {
    type: BRAIN_EVENTS.FILE_WRITE_START,
    fileName,
    stepTitle: ctx.stepTitle,
    options: ctx.options,
    brainRunId: ctx.brainRunId,
  };
}

function completeEvent(
  ctx: EventContext,
  fileName: string
): FileWriteCompleteEvent {
  return {
    type: BRAIN_EVENTS.FILE_WRITE_COMPLETE,
    fileName,
    stepTitle: ctx.stepTitle,
    options: ctx.options,
    brainRunId: ctx.brainRunId,
  };
}

function wrapFileHandle(
  handle: FileHandle,
  channel: EventSink,
  ctx: EventContext
): FileHandle {
  return {
    name: handle.name,
    get url() {
      return handle.url;
    },
    read: () => handle.read(),
    readBytes: () => handle.readBytes(),
    async write(content: FileInput): Promise<FileRef> {
      channel.push(startEvent(ctx, handle.name));
      const ref = await handle.write(content);
      channel.push(completeEvent(ctx, handle.name));
      return ref;
    },
    exists: () => handle.exists(),
    delete: () => handle.delete(),
  };
}

function wrapZipBuilder(
  zip: ZipBuilder,
  channel: EventSink,
  ctx: EventContext,
  zipName: string
): ZipBuilder {
  return {
    async write(name: string, content: FileInput): Promise<void> {
      channel.push(startEvent(ctx, name));
      await zip.write(name, content);
      channel.push(completeEvent(ctx, name));
    },
    async finalize(): Promise<FileRef> {
      channel.push(startEvent(ctx, zipName));
      const ref = await zip.finalize();
      channel.push(completeEvent(ctx, zipName));
      return ref;
    },
  };
}

/**
 * Wraps a Files to push events onto a channel during write operations.
 * The wrapper is transparent — same interface, brain authors see no change.
 */
export function wrapFilesWithEvents(
  files: Files,
  channel: EventSink,
  ctx: EventContext
): Files {
  return {
    open(name: string, options?: FileOptions): FileHandle {
      return wrapFileHandle(files.open(name, options), channel, ctx);
    },
    async write(
      name: string,
      content: FileInput,
      options?: FileOptions
    ): Promise<FileRef> {
      channel.push(startEvent(ctx, name));
      const ref = await files.write(name, content, options);
      channel.push(completeEvent(ctx, name));
      return ref;
    },
    list: () => files.list(),
    delete: (name: string) => files.delete(name),
    zip(name: string, options?: FileOptions): ZipBuilder {
      return wrapZipBuilder(files.zip(name, options), channel, ctx, name);
    },
  };
}
