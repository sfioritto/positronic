import type {
  Files,
  FileHandle,
  FileInput,
  FileOptions,
  FileRef,
  ZipBuilder,
  RuntimeEnv,
  CurrentUser,
} from '@positronic/core';
import type { R2Bucket } from '@cloudflare/workers-types';
import { guessContentType } from './content-type.js';
import { createR2ZipBuilder } from './zip-builder.js';
import { isFileHandle } from './file-utils.js';

export function createFiles(
  bucket: R2Bucket,
  brainTitle: string,
  brainRunId: string,
  currentUser: CurrentUser,
  env: RuntimeEnv
): Files {
  function resolveKey(name: string, options?: FileOptions): string {
    const scope = options?.scope ?? 'brain';
    const userName = currentUser.name;

    switch (scope) {
      case 'run':
        return `files/user/${userName}/${brainTitle}/runs/${brainRunId}/${name}`;
      case 'brain':
        return `files/user/${userName}/${brainTitle}/${name}`;
      case 'global':
        return `files/user/${userName}/${name}`;
    }
  }

  function createFileHandle(name: string, options?: FileOptions): FileHandle {
    const key = resolveKey(name, options);

    async function writeContent(content: FileInput): Promise<FileRef> {
      const contentType = guessContentType(name);

      if (typeof content === 'string') {
        await bucket.put(key, content, {
          httpMetadata: { contentType },
        });
      } else if (content instanceof Uint8Array) {
        await bucket.put(key, content, {
          httpMetadata: { contentType },
        });
      } else if (content instanceof Response) {
        // R2's ReadableStream type differs from the standard lib's — cast through any
        await bucket.put(key, content.body as any, {
          httpMetadata: { contentType },
        });
      } else if (isFileHandle(content)) {
        // Read from the source handle — it knows its own scope and key.
        // Uses readBytes() to handle both text and binary files correctly.
        const sourceBytes = await content.readBytes();
        await bucket.put(key, sourceBytes, {
          httpMetadata: { contentType },
        });
      } else {
        // ReadableStream — R2's type differs from standard lib's, cast through any
        await bucket.put(key, content as any, {
          httpMetadata: { contentType },
        });
      }

      return { name };
    }

    const handle: FileHandle = {
      name,

      get url() {
        // R2 key is "files/user/..." — strip the "files/" prefix since the
        // route is already mounted at /files/
        return `${env.origin}/files/${key.slice('files/'.length)}`;
      },

      async read() {
        const object = await bucket.get(key);
        if (!object) {
          throw new Error(`File '${name}' not found`);
        }
        return object.text();
      },

      async readBytes() {
        const object = await bucket.get(key);
        if (!object) {
          throw new Error(`File '${name}' not found`);
        }
        const arrayBuffer = await object.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      },

      write: writeContent,

      async exists() {
        const object = await bucket.head(key);
        return object !== null;
      },

      async delete() {
        await bucket.delete(key);
      },
    };

    return handle;
  }

  return {
    open(name: string, options?: FileOptions): FileHandle {
      return createFileHandle(name, options);
    },

    async write(
      name: string,
      content: FileInput,
      options?: FileOptions
    ): Promise<FileRef> {
      const handle = createFileHandle(name, options);
      return handle.write(content);
    },

    async list(): Promise<FileRef[]> {
      const prefix = `files/user/${currentUser.name}/${brainTitle}/`;
      const refs: FileRef[] = [];
      let cursor: string | undefined;

      do {
        const listed = await bucket.list({ prefix, cursor });
        for (const object of listed.objects) {
          // Extract the file name from the key by removing the prefix
          const name = object.key.slice(prefix.length);
          // Skip run-scoped files (they're in a runs/ subdirectory)
          if (!name.startsWith('runs/')) {
            refs.push({ name });
          }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      return refs;
    },

    async delete(name: string): Promise<void> {
      const handle = createFileHandle(name);
      await handle.delete();
    },

    zip(name: string, options?: FileOptions): ZipBuilder {
      const key = resolveKey(name, options);
      return createR2ZipBuilder(bucket, key, name);
    },
  };
}
