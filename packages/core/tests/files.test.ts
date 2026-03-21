import { jest } from '@jest/globals';
import { brain } from '../src/dsl/builder/brain.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import type { ObjectGenerator } from '../src/clients/types.js';
import type {
  FilesService,
  FileHandle,
  FileInput,
  FileOptions,
  FileRef,
  ZipBuilder,
} from '../src/files/types.js';

const collectEvents = async <T>(
  iterator: AsyncIterableIterator<T>
): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
};

function createInMemoryFilesService(
  origin: string = 'http://localhost:8787'
): FilesService & { storage: Map<string, string | Uint8Array> } {
  const storage = new Map<string, string | Uint8Array>();

  function resolveKey(name: string, options?: FileOptions): string {
    const scope = options?.scope ?? 'brain';
    switch (scope) {
      case 'run':
        return `files/user/test-user/test-brain/runs/run-1/${name}`;
      case 'brain':
        return `files/user/test-user/test-brain/${name}`;
      case 'global':
        return `files/user/test-user/${name}`;
    }
  }

  function createHandle(name: string, options?: FileOptions): FileHandle {
    const key = resolveKey(name, options);

    const handle: FileHandle = {
      name,
      get url() {
        return `${origin}/files/${key.slice('files/'.length)}`;
      },
      async read() {
        const data = storage.get(key);
        if (data === undefined) throw new Error(`File '${name}' not found`);
        if (typeof data === 'string') return data;
        return new TextDecoder().decode(data);
      },
      async readBytes() {
        const data = storage.get(key);
        if (data === undefined) throw new Error(`File '${name}' not found`);
        if (data instanceof Uint8Array) return data;
        return new TextEncoder().encode(data);
      },
      async write(content: FileInput) {
        if (typeof content === 'string') {
          storage.set(key, content);
        } else if (content instanceof Uint8Array) {
          storage.set(key, content);
        } else if (content instanceof Response) {
          const text = await content.text();
          storage.set(key, text);
        } else if (
          content !== null &&
          typeof content === 'object' &&
          'read' in content &&
          typeof (content as any).read === 'function'
        ) {
          // FileHandle
          const sourceContent = await (content as FileHandle).read();
          storage.set(key, sourceContent);
        } else {
          // ReadableStream — collect all chunks
          const reader = (content as ReadableStream).getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          storage.set(key, result);
        }
        return { name };
      },
      async exists() {
        return storage.has(key);
      },
      async delete() {
        storage.delete(key);
      },
    };

    return handle;
  }

  const service: FilesService & { storage: Map<string, string | Uint8Array> } =
    {
      storage,
      open(name: string, options?: FileOptions) {
        return createHandle(name, options);
      },
      async write(name: string, content: FileInput, options?: FileOptions) {
        const handle = createHandle(name, options);
        return handle.write(content);
      },
      async list() {
        const prefix = 'files/user/test-user/test-brain/';
        const refs: FileRef[] = [];
        for (const key of storage.keys()) {
          if (key.startsWith(prefix)) {
            const name = key.slice(prefix.length);
            if (!name.startsWith('runs/')) {
              refs.push({ name });
            }
          }
        }
        return refs;
      },
      async delete(name: string) {
        const handle = createHandle(name);
        await handle.delete();
      },
      zip(name: string, options?: FileOptions): ZipBuilder {
        const entries: Array<{ name: string; content: string | Uint8Array }> =
          [];
        return {
          async write(entryName: string, content: FileInput) {
            if (typeof content === 'string') {
              entries.push({ name: entryName, content });
            } else if (content instanceof Uint8Array) {
              entries.push({ name: entryName, content });
            } else if ('read' in (content as any)) {
              const text = await (content as FileHandle).read();
              entries.push({ name: entryName, content: text });
            } else {
              entries.push({ name: entryName, content: '[stream]' });
            }
          },
          async finalize() {
            // Store entries as JSON so tests can inspect what went into the zip
            const key = resolveKey(name, options);
            storage.set(key, JSON.stringify(entries.map((e) => e.name)));
            return { name };
          },
        };
      },
    };

  return service;
}

const createMockClient = (): jest.Mocked<ObjectGenerator> => ({
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
});

describe('files service', () => {
  it('should inject files into step context', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    let receivedFiles: FilesService | undefined;

    const testBrain = brain('test-brain').step('Check files', ({ files }) => {
      receivedFiles = files;
      return { done: true };
    });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );

    expect(receivedFiles).toBeDefined();
    // Receives a wrapped version (for event emission), not the raw service
    expect(receivedFiles).not.toBe(filesService);
  });

  it('should write and read text files', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Write and read',
      async ({ files }) => {
        const file = files!.open('report.txt');
        await file.write('hello world');

        const content = await file.read();
        return { content };
      }
    );

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );

    const completeEvent = events.find(
      (e: any) => e.type === BRAIN_EVENTS.STEP_COMPLETE
    ) as any;
    expect(completeEvent).toBeDefined();

    // Verify the file was stored
    expect(
      filesService.storage.has('files/user/test-user/test-brain/report.txt')
    ).toBe(true);
  });

  it('should write binary content', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Write binary',
      async ({ files }) => {
        const file = files!.open('data.bin');
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        await file.write(bytes);

        const readBack = await file.readBytes();
        return { length: readBack.length };
      }
    );

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );

    expect(
      filesService.storage.has('files/user/test-user/test-brain/data.bin')
    ).toBe(true);
  });

  it('should compute url from origin', async () => {
    const filesService = createInMemoryFilesService(
      'https://myapp.workers.dev'
    );

    const file = filesService.open('report.txt');
    expect(file.url).toBe(
      'https://myapp.workers.dev/files/user/test-user/test-brain/report.txt'
    );
  });

  it('should handle file existence check', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Check existence',
      async ({ files }) => {
        const file = files!.open('maybe.txt');
        const beforeWrite = await file.exists();
        await file.write('content');
        const afterWrite = await file.exists();
        return { beforeWrite, afterWrite };
      }
    );

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );
  });

  it('should delete files', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Delete file',
      async ({ files }) => {
        await files!.write('temp.txt', 'temporary');
        const existsBefore = await files!.open('temp.txt').exists();
        await files!.delete('temp.txt');
        const existsAfter = await files!.open('temp.txt').exists();
        return { existsBefore, existsAfter };
      }
    );

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );
  });

  it('should list files', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'List files',
      async ({ files }) => {
        await files!.write('file1.txt', 'content 1');
        await files!.write('file2.txt', 'content 2');
        const list = await files!.list();
        return { count: list.length };
      }
    );

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );
  });

  it('should scope files by scope option', async () => {
    const filesService = createInMemoryFilesService();

    // Write to different scopes
    await filesService.write('shared.txt', 'brain scope');
    await filesService.write('temp.txt', 'run scope', { scope: 'run' });
    await filesService.write('global.txt', 'global scope', {
      scope: 'global',
    });

    // Verify different keys were used
    expect(
      filesService.storage.has('files/user/test-user/test-brain/shared.txt')
    ).toBe(true);
    expect(
      filesService.storage.has(
        'files/user/test-user/test-brain/runs/run-1/temp.txt'
      )
    ).toBe(true);
    expect(filesService.storage.has('files/user/test-user/global.txt')).toBe(
      true
    );
  });

  it('should copy content between files', async () => {
    const filesService = createInMemoryFilesService();

    const source = filesService.open('source.txt');
    await source.write('original content');

    const dest = filesService.open('dest.txt');
    await dest.write(source);

    const content = await dest.read();
    expect(content).toBe('original content');
  });

  it('should propagate files to inner brains and inner writes work', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const innerBrain = brain('inner-brain').step(
      'Inner write',
      async ({ files }) => {
        await files!.write('inner-file.txt', 'from inner brain');
        return { inner: true };
      }
    );

    const outerBrain = brain('test-brain')
      .step('Outer step', () => ({ started: true }))
      .brain('Run inner', innerBrain, {
        initialState: () => ({}),
      });

    await collectEvents(
      outerBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );

    // Verify the inner brain's write actually worked
    const content = await filesService.open('inner-file.txt').read();
    expect(content).toBe('from inner brain');
  });

  it('should use convenience write method', async () => {
    const filesService = createInMemoryFilesService();

    const ref = await filesService.write('quick.txt', 'fast write');
    expect(ref.name).toBe('quick.txt');

    const content = await filesService.open('quick.txt').read();
    expect(content).toBe('fast write');
  });

  it('should create a zip builder synchronously', () => {
    const filesService = createInMemoryFilesService();
    const zip = filesService.zip('bundle.zip');
    expect(zip).toBeDefined();
    expect(zip.write).toBeDefined();
    expect(zip.finalize).toBeDefined();
  });

  it('should add entries to zip and finalize', async () => {
    const filesService = createInMemoryFilesService();
    const zip = filesService.zip('bundle.zip');

    await zip.write('file1.txt', 'hello');
    await zip.write('file2.txt', 'world');
    const ref = await zip.finalize();

    expect(ref.name).toBe('bundle.zip');
  });

  it('should add file handle to zip', async () => {
    const filesService = createInMemoryFilesService();

    await filesService.write('source.txt', 'source content');
    const sourceHandle = filesService.open('source.txt');

    const zip = filesService.zip('bundle.zip');
    await zip.write('included.txt', sourceHandle);
    const ref = await zip.finalize();

    expect(ref.name).toBe('bundle.zip');
  });

  it('should use zip in a brain step', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Create zip',
      async ({ files }) => {
        const zip = files!.zip('results.zip');
        await zip.write('data.txt', 'test data');
        const ref = await zip.finalize();
        return { zipFile: ref.name };
      }
    );

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );
  });

  it('should emit file events mid-step for writes and handle writes', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Write files',
      async ({ files }) => {
        // Convenience write
        await files!.write('report.txt', 'hello');
        // Handle write
        const file = files!.open('output.txt');
        await file.write('via handle');
        return { done: true };
      }
    );

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );

    const fileEvents = events.filter(
      (e: any) =>
        e.type === BRAIN_EVENTS.FILE_WRITE_START ||
        e.type === BRAIN_EVENTS.FILE_WRITE_COMPLETE
    );

    // 2 writes × (START + COMPLETE) = 4 events
    expect(fileEvents.length).toBe(4);
    expect((fileEvents[0] as any).fileName).toBe('report.txt');
    expect((fileEvents[2] as any).fileName).toBe('output.txt');
    expect((fileEvents[0] as any).stepTitle).toBe('Write files');

    // File events appear between step start and step complete
    const types = events.map((e: any) => e.type);
    const stepStartIdx = types.indexOf(BRAIN_EVENTS.STEP_START);
    const stepCompleteIdx = types.indexOf(BRAIN_EVENTS.STEP_COMPLETE);
    const fileStartIdx = types.indexOf(BRAIN_EVENTS.FILE_WRITE_START);

    expect(fileStartIdx).toBeGreaterThan(stepStartIdx);
    expect(fileStartIdx).toBeLessThan(stepCompleteIdx);
  });

  it('should emit events for zip write and finalize operations', async () => {
    const filesService = createInMemoryFilesService();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain').step(
      'Build zip',
      async ({ files }) => {
        const zip = files!.zip('bundle.zip');
        await zip.write('a.txt', 'content a');
        await zip.write('b.txt', 'content b');
        await zip.finalize();
        return { done: true };
      }
    );

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { name: 'test-user' },
        files: filesService,
      })
    );

    const fileEvents = events.filter(
      (e: any) =>
        e.type === BRAIN_EVENTS.FILE_WRITE_START ||
        e.type === BRAIN_EVENTS.FILE_WRITE_COMPLETE
    );

    // 3 operations: write a.txt, write b.txt, finalize bundle.zip
    // Each has START + COMPLETE = 6 events
    expect(fileEvents.length).toBe(6);
    expect((fileEvents[0] as any).fileName).toBe('a.txt');
    expect((fileEvents[2] as any).fileName).toBe('b.txt');
    expect((fileEvents[4] as any).fileName).toBe('bundle.zip');
  });
});
