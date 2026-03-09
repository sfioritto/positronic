import { jest } from '@jest/globals';
import { z } from 'zod';
import type { Store, StoreProvider } from '../src/store/types.js';
import { brain } from '../src/dsl/builder/brain.js';
import { BRAIN_EVENTS } from '../src/dsl/constants.js';
import type { ObjectGenerator } from '../src/clients/types.js';

// Helper function to collect all events from a brain run
const collectEvents = async <T>(
  iterator: AsyncIterableIterator<T>
): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
};

// In-memory store factory for testing — mimics key resolution like a real backend
const createInMemoryStoreProvider = (): StoreProvider & { data: Map<string, any> } => {
  const data = new Map<string, any>();

  const factory: StoreProvider & { data: Map<string, any> } = Object.assign(
    ({ schema, brainTitle, currentUser }: Parameters<StoreProvider>[0]) => {
      // Parse per-user keys from schema
      const perUserKeys = new Set<string>();
      for (const [key, value] of Object.entries(schema)) {
        if (value !== null && typeof value === 'object' && 'perUser' in value && (value as any).perUser === true) {
          perUserKeys.add(key);
        }
      }

      function resolveKey(key: string): string {
        if (perUserKeys.has(key)) {
          if (!currentUser) {
            throw new Error(
              `Store key "${key}" is per-user but no currentUser was provided. ` +
              `Per-user store keys require a currentUser in run params.`
            );
          }
          return `store/${brainTitle}/user/${currentUser.id}/${key}`;
        }
        return `store/${brainTitle}/${key}`;
      }

      const store: Store<any> = {
        async get(key: string) { return data.get(resolveKey(key)); },
        async set(key: string, value: any) { data.set(resolveKey(key), value); },
        async delete(key: string) { data.delete(resolveKey(key)); },
        async has(key: string) { return data.has(resolveKey(key)); },
      };

      return store;
    },
    { data }
  );

  return factory;
};

// Mock ObjectGenerator for testing
const createMockClient = (): jest.Mocked<ObjectGenerator> => ({
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
});

describe('Brain.withStore', () => {
  it('should inject store into step context', async () => {
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    let receivedStore: any;

    const testBrain = brain('test-brain')
      .withStore({ counter: z.number() })
      .step('Test Step', ({ store }) => {
        receivedStore = store;
        return { done: true };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(receivedStore).toBeDefined();
  });

  it('should allow get and set in step with brain-scoped keys', async () => {
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain')
      .withStore({
        items: z.array(z.string()),
      })
      .step('Add Items', async ({ store }) => {
        const current = await store.get('items');
        await store.set('items', [...(current ?? []), 'new-item']);
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    // Verify data was stored at the brain-scoped path
    expect(storeFactory.data.get('store/test-brain/items')).toEqual(['new-item']);
  });

  it('should preserve store through step chain', async () => {
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    let step1Store: any;
    let step2Store: any;

    const testBrain = brain('test-brain')
      .withStore({ counter: z.number() })
      .step('Step 1', ({ store }) => {
        step1Store = store;
        return { step: 1 };
      })
      .step('Step 2', ({ store }) => {
        step2Store = store;
        return { step: 2 };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    expect(step1Store).toBeDefined();
    expect(step2Store).toBeDefined();
    // Both steps should have the same typed store
    expect(step1Store).toBe(step2Store);
  });

  it('should work alongside withServices', async () => {
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    interface TestServices {
      logger: { log: (msg: string) => void };
    }

    const mockLogger = { log: jest.fn() };
    let receivedStore: any;
    let receivedLogger: any;

    const testBrain = brain('test-brain')
      .withStore({ value: z.string() })
      .withServices<TestServices>({ logger: mockLogger })
      .step('Combined Step', ({ store, logger }) => {
        receivedStore = store;
        receivedLogger = logger;
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    expect(receivedStore).toBeDefined();
    expect(receivedLogger).toBe(mockLogger);
  });

  it('should be undefined when store is not configured', async () => {
    const mockClient = createMockClient();

    let receivedStore: any = 'not-undefined';

    const testBrain = brain('test-brain').step('No Store Step', (params) => {
      receivedStore = (params as any).store;
      return { done: true };
    });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
      })
    );

    expect(receivedStore).toBeUndefined();
  });

  it('should be undefined when store is configured but no factory is given', async () => {
    const mockClient = createMockClient();

    let receivedStore: any = 'not-undefined';

    const testBrain = brain('test-brain')
      .withStore({ counter: z.number() })
      .step('No Backend Step', ({ store }) => {
        receivedStore = store;
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        // No store factory
      })
    );

    expect(receivedStore).toBeUndefined();
  });

  it('should scope per-user keys to currentUser', async () => {
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    const testBrain = brain('test-brain')
      .withStore({
        sharedCounter: z.number(),
        userPref: { type: z.string(), perUser: true },
      })
      .step('Use Store', async ({ store }) => {
        await store.set('sharedCounter', 1);
        await store.set('userPref', 'dark');
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'user-42' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    // Shared key uses brain-scoped path
    expect(storeFactory.data.get('store/test-brain/sharedCounter')).toBe(1);
    // Per-user key uses user-scoped path
    expect(storeFactory.data.get('store/test-brain/user/user-42/userPref')).toBe('dark');
  });

  it('should isolate store data between different brains', async () => {
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    const brainA = brain('brain-a')
      .withStore({ counter: z.number() })
      .step('Set Counter', async ({ store }) => {
        await store.set('counter', 100);
        return { done: true };
      });

    const brainB = brain('brain-b')
      .withStore({ counter: z.number() })
      .step('Set Counter', async ({ store }) => {
        await store.set('counter', 999);
        return { done: true };
      });

    // Run both brains against the same backend
    await collectEvents(
      brainA.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    await collectEvents(
      brainB.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    // Each brain's data is stored under its own namespace
    expect(storeFactory.data.get('store/brain-a/counter')).toBe(100);
    expect(storeFactory.data.get('store/brain-b/counter')).toBe(999);
  });

  it('should work with store passed via createBrain', async () => {
    const { createBrain } = await import('../src/dsl/create-brain.js');
    const storeFactory = createInMemoryStoreProvider();
    const mockClient = createMockClient();

    const myBrain = createBrain({
      store: { counter: z.number() },
    });

    let receivedStore: any;

    const testBrain = myBrain('test-brain')
      .step('Test', ({ store }) => {
        receivedStore = store;
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: storeFactory,
      })
    );

    expect(receivedStore).toBeDefined();
  });
});
