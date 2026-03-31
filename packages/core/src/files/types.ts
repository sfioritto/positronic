/**
 * Accepted input types for file write operations.
 * - string: text content, written as UTF-8
 * - Uint8Array: binary content
 * - Response: fetch response — body is streamed, never fully buffered
 * - ReadableStream: streamed directly to storage
 * - FileHandle: another file — content is streamed from storage to storage
 */
export type FileInput =
  | string
  | Uint8Array
  | Response
  | ReadableStream
  | FileHandle;

/**
 * Options for file operations.
 * Scope controls where the file is stored and who can access it.
 * All scopes are always per-user — files are never visible to other users.
 */
export interface FileOptions {
  /**
   * - 'run': ephemeral, scoped to this brain run (cleaned up after run completes)
   * - 'brain': persists across runs, scoped to this brain + user (default)
   * - 'global': persists across runs AND across brains, scoped to user
   */
  scope?: 'run' | 'brain' | 'global';
}

/**
 * Lightweight reference to a file. Stored in brain state to track files
 * without serializing URLs (which are environment-dependent).
 */
export interface FileRef {
  name: string;
}

/**
 * A lazy file handle. Created by files.open() — no I/O until you call a method.
 * The `url` property is computed from the current origin, never stale.
 */
export interface FileHandle {
  /** The file name (identifier within its scope) */
  name: string;
  /** Public download URL, computed from current origin */
  url: string;

  /** Read file content as UTF-8 text (buffers into memory) */
  read(): Promise<string>;
  /** Read file content as binary (buffers into memory) */
  readBytes(): Promise<Uint8Array>;

  /**
   * Write content to the file. Accepts multiple input types:
   * - string or Uint8Array: written directly
   * - Response: body is streamed (from fetch)
   * - ReadableStream: streamed directly
   * - FileHandle: content streamed from another file (R2-to-R2)
   */
  write(content: FileInput): Promise<FileRef>;

  /** Check if the file exists in storage */
  exists(): Promise<boolean>;
  /** Delete the file from storage */
  delete(): Promise<void>;
}

/**
 * Streaming zip builder. Created by files.zip() — no I/O until write() is called.
 * Content is streamed through a zip encoder and uploaded to storage via multipart upload.
 * Peak memory: ~5MB part buffer + one in-flight chunk.
 */
export interface ZipBuilder {
  /** Add content to the zip. Same input types as file.write(). */
  write(name: string, content: FileInput): Promise<void>;
  /** Complete the zip and upload. Returns a ref to the zip file. */
  finalize(): Promise<FileRef>;
}

/**
 * Service for creating and managing files during brain execution.
 * Available on the step context as `files`.
 *
 * Files are always scoped per-user. Default scope is 'brain' (persists across runs).
 */
export interface Files {
  /**
   * Get a lazy file handle. No I/O — returns immediately.
   * Use methods on the handle to read, write, or check existence.
   */
  open(name: string, options?: FileOptions): FileHandle;

  /** Convenience: open(name, options).write(content) */
  write(
    name: string,
    content: FileInput,
    options?: FileOptions
  ): Promise<FileRef>;

  /** List all files in the default scope */
  list(): Promise<FileRef[]>;

  /** Delete a file by name */
  delete(name: string): Promise<void>;

  /** Create a streaming zip builder. Returns synchronously — no I/O until write(). */
  zip(name: string, options?: FileOptions): ZipBuilder;
}
