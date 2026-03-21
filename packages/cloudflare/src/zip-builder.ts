import { Zip, ZipPassThrough } from 'fflate';
import type { ZipBuilder, FileInput, FileRef } from '@positronic/core';
import type {
  R2Bucket,
  R2MultipartUpload,
  R2UploadedPart,
} from '@cloudflare/workers-types';
import { isFileHandle } from './file-utils.js';

const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB — R2 minimum part size

export function createR2ZipBuilder(
  bucket: R2Bucket,
  key: string,
  name: string
): ZipBuilder {
  let zip: Zip | null = null;
  let multipartUpload: R2MultipartUpload | null = null;
  let buffer: Uint8Array[] = [];
  let bufferSize = 0;
  let parts: R2UploadedPart[] = [];
  let partNumber = 1;
  let finalized = false;
  let aborted = false;

  function ensureNotFinalized() {
    if (finalized) throw new Error('ZipBuilder has already been finalized');
    if (aborted)
      throw new Error('ZipBuilder has been aborted due to a previous error');
  }

  async function initialize() {
    if (zip) return;

    multipartUpload = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: 'application/zip' },
    });

    zip = new Zip((err, data, final) => {
      if (err) return; // Error handled at the call site
      if (data.length > 0) {
        buffer.push(data);
        bufferSize += data.length;
      }
    });
  }

  async function flushBuffer() {
    if (bufferSize === 0 || !multipartUpload) return;

    const data = concatenateBuffer();
    const part = await multipartUpload.uploadPart(partNumber++, data);
    parts.push(part);
    buffer = [];
    bufferSize = 0;
  }

  async function flushIfNeeded() {
    if (bufferSize >= MIN_PART_SIZE) {
      await flushBuffer();
    }
  }

  function concatenateBuffer(): Uint8Array {
    if (buffer.length === 1) return buffer[0];

    const result = new Uint8Array(bufferSize);
    let offset = 0;
    for (const chunk of buffer) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  async function abort() {
    if (multipartUpload && !finalized && !aborted) {
      aborted = true;
      await multipartUpload.abort();
    }
  }

  async function pushStreamThroughEntry(
    entry: ZipPassThrough,
    stream: ReadableStream<Uint8Array>
  ) {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        entry.push(new Uint8Array(0), true);
        break;
      }
      entry.push(value, false);
      await flushIfNeeded();
    }
  }

  return {
    async write(entryName: string, content: FileInput): Promise<void> {
      ensureNotFinalized();

      try {
        await initialize();

        const entry = new ZipPassThrough(entryName);
        zip!.add(entry);

        if (typeof content === 'string') {
          const encoded = new TextEncoder().encode(content);
          entry.push(encoded, true);
        } else if (content instanceof Uint8Array) {
          entry.push(content, true);
        } else if (content instanceof Response) {
          if (!content.body) {
            entry.push(new Uint8Array(0), true);
          } else {
            await pushStreamThroughEntry(entry, content.body);
          }
        } else if (isFileHandle(content)) {
          const bytes = await content.readBytes();
          entry.push(bytes, true);
        } else {
          // ReadableStream
          await pushStreamThroughEntry(
            entry,
            content as ReadableStream<Uint8Array>
          );
        }

        await flushIfNeeded();
      } catch (error) {
        await abort();
        throw error;
      }
    },

    async finalize(): Promise<FileRef> {
      ensureNotFinalized();

      try {
        await initialize();
        zip!.end();

        // Upload remaining buffer as final part
        await flushBuffer();

        await multipartUpload!.complete(parts);
        finalized = true;

        return { name };
      } catch (error) {
        await abort();
        throw error;
      }
    },
  };
}
