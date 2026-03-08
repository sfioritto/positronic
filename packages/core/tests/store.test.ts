import { jest } from '@jest/globals';
import { createStore } from '../src/store/create-store.js';
import { createTypedStore } from '../src/store/create-typed-store.js';
import type { StoreProvider } from '../src/store/types.js';
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

// Mock store provider for testing
const createMockProvider = (): jest.Mocked<StoreProvider> & { data: Map<string, any> } => {
  const data = new Map<string, any>();
  return {
    data,
    get: jest.fn<StoreProvider['get']>().mockImplementation(async (key) => data.get(key)),
    set: jest.fn<StoreProvider['set']>().mockImplementation(async (key, value) => { data.set(key, value); }),
    delete: jest.fn<StoreProvider['delete']>().mockImplementation(async (key) => { data.delete(key); }),
    has: jest.fn<StoreProvider['has']>().mockImplementation(async (key) => data.has(key)),
  };
};

// Mock ObjectGenerator for testing
const createMockClient = (): jest.Mocked<ObjectGenerator> => ({
  generateObject: jest.fn<ObjectGenerator['generateObject']>(),
  streamText: jest.fn<ObjectGenerator['streamText']>(),
});

describe('createStore', () => {
  it('should return a store definition with defaults', () => {
    const store = createStore({
      deselectedThreads: [] as string[],
      lastDigestDate: '',
    });

    expect(store.defaults).toEqual({
      deselectedThreads: [],
      lastDigestDate: '',
    });
  });
});

describe('createTypedStore', () => {
  it('should get a stored value', async () => {
    const provider = createMockProvider();
    const definition = createStore({ count: 0 });
    const store = createTypedStore(provider, definition);

    provider.data.set('count', 42);

    const result = await store.get('count');
    expect(result).toBe(42);
    expect(provider.get).toHaveBeenCalledWith('count');
  });

  it('should return default value when key does not exist', async () => {
    const provider = createMockProvider();
    const definition = createStore({
      items: ['default-item'] as string[],
    });
    const store = createTypedStore(provider, definition);

    const result = await store.get('items');
    expect(result).toEqual(['default-item']);
  });

  it('should set a value', async () => {
    const provider = createMockProvider();
    const definition = createStore({ name: '' });
    const store = createTypedStore(provider, definition);

    await store.set('name', 'test-value');
    expect(provider.set).toHaveBeenCalledWith('name', 'test-value');
    expect(provider.data.get('name')).toBe('test-value');
  });

  it('should delete a value', async () => {
    const provider = createMockProvider();
    const definition = createStore({ count: 0 });
    const store = createTypedStore(provider, definition);

    provider.data.set('count', 42);
    await store.delete('count');
    expect(provider.delete).toHaveBeenCalledWith('count');
    expect(provider.data.has('count')).toBe(false);
  });

  it('should check if a key exists', async () => {
    const provider = createMockProvider();
    const definition = createStore({ count: 0 });
    const store = createTypedStore(provider, definition);

    expect(await store.has('count')).toBe(false);

    provider.data.set('count', 42);
    expect(await store.has('count')).toBe(true);
  });
});

describe('Brain.withStore', () => {
  it('should inject store into step context', async () => {
    const provider = createMockProvider();
    const mockClient = createMockClient();

    const storeDefinition = createStore({ counter: 0 });
    let receivedStore: any;

    const testBrain = brain('test-brain')
      .withStore(storeDefinition)
      .step('Test Step', ({ store }) => {
        receivedStore = store;
        return { done: true };
      });

    const events = await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: provider,
      })
    );

    expect(events.some((e) => e.type === BRAIN_EVENTS.COMPLETE)).toBe(true);
    expect(receivedStore).toBeDefined();
  });

  it('should allow get and set in step', async () => {
    const provider = createMockProvider();
    const mockClient = createMockClient();

    const storeDefinition = createStore({
      items: [] as string[],
    });

    const testBrain = brain('test-brain')
      .withStore(storeDefinition)
      .step('Add Items', async ({ store }) => {
        const current = await store.get('items');
        await store.set('items', [...current, 'new-item']);
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        storeProvider: provider,
      })
    );

    // Verify the provider was called correctly
    expect(provider.get).toHaveBeenCalledWith('items');
    expect(provider.set).toHaveBeenCalledWith('items', ['new-item']);
  });

  it('should preserve store through step chain', async () => {
    const provider = createMockProvider();
    const mockClient = createMockClient();

    const storeDefinition = createStore({ counter: 0 });
    let step1Store: any;
    let step2Store: any;

    const testBrain = brain('test-brain')
      .withStore(storeDefinition)
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
        storeProvider: provider,
      })
    );

    expect(step1Store).toBeDefined();
    expect(step2Store).toBeDefined();
    // Both steps should have the same typed store
    expect(step1Store).toBe(step2Store);
  });

  it('should work alongside withServices', async () => {
    const provider = createMockProvider();
    const mockClient = createMockClient();

    interface TestServices {
      logger: { log: (msg: string) => void };
    }

    const mockLogger = { log: jest.fn() };
    const storeDefinition = createStore({ value: '' });
    let receivedStore: any;
    let receivedLogger: any;

    const testBrain = brain('test-brain')
      .withStore(storeDefinition)
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
        storeProvider: provider,
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

  it('should be undefined when store is configured but no provider is given', async () => {
    const mockClient = createMockClient();

    const storeDefinition = createStore({ counter: 0 });
    let receivedStore: any = 'not-undefined';

    const testBrain = brain('test-brain')
      .withStore(storeDefinition)
      .step('No Provider Step', ({ store }) => {
        receivedStore = store;
        return { done: true };
      });

    await collectEvents(
      testBrain.run({
        client: mockClient,
        currentUser: { id: 'test-user' },
        resources: {} as any,
        // No storeProvider
      })
    );

    expect(receivedStore).toBeUndefined();
  });
});
